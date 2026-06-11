import { eq, sql } from 'drizzle-orm';
import { resolveAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import type { CreateBranchError } from '@shared/git';
import { err, ok, type Result } from '@shared/result';
import { deriveTaskSlug } from '@shared/task-name';
import {
  createTaskStrategyRequiresBranchName,
  type CreateTaskError,
  type CreateTaskParams,
  type CreateTaskSuccess,
  type CreateTaskWarning,
  type TaskLifecycleStatus,
} from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { generateTaskNames } from '@main/core/tasks/name-generation/task-naming-service';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { conversations, tasks, type TaskRow } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { createConversation } from '../../conversations/createConversation';
import { renameConversation } from '../../conversations/renameConversation';
import { prQueryService } from '../../pull-requests/pr-query-service';
import { appSettingsService } from '../../settings/settings-service';
import type { ProvisionTaskError } from '../provision-task-error';
import { resolveTaskBranchName } from '../resolveTaskBranchName';
import { toStoredBranch } from '../stored-branch';
import { mapTaskRowToTask } from '../utils/utils';
import { replaceTaskIssueLinks } from './task-issues';
import { renameTaskBranchForName } from './taskBranchRename';

function mapProvisionError(error: ProvisionTaskError): CreateTaskError {
  switch (error.type) {
    case 'branch-not-found':
      return { type: 'branch-not-found', branch: error.branch };
    case 'worktree-setup-failed':
      return {
        type: 'worktree-setup-failed',
        branch: error.branch,
        message: error.message,
      };
    case 'timeout':
      return { type: 'provision-timeout', timeoutMs: error.timeout, step: error.step };
    default:
      return { type: 'provision-failed', message: error.message };
  }
}

type BranchSetupResult =
  | { success: true; taskBranch: string | undefined; warning?: CreateTaskWarning }
  | { success: false; branch: string; message: string };

function branchSeed(strategy: CreateTaskParams['strategy']): string | undefined {
  if (strategy.kind === 'new-branch') return strategy.taskBranch;
  if (strategy.kind === 'from-pull-request') return strategy.taskBranch || strategy.headBranch;
  return undefined;
}

/**
 * Short time-based branch seed. Branch names are decoupled from generated
 * titles: when auto-naming owns the branch, it gets this hash up front instead
 * of being renamed once the LLM title arrives.
 */
function timeBranchSeed(): string {
  return Date.now().toString(36);
}

function formatCreateBranchError(error: CreateBranchError): string {
  switch (error.type) {
    case 'already_exists':
      return `Branch "${error.name}" already exists.`;
    case 'invalid_base':
      return `Source branch "${error.from}" is not a valid base.`;
    case 'invalid_name':
      return `Branch "${error.name}" is not a valid branch name.`;
    default:
      return error.message;
  }
}

async function markSetupFailure(
  taskId: string,
  status: 'naming_failed' | 'branch_failed',
  message: string,
  fallbackRow?: TaskRow
): Promise<TaskRow> {
  const [updatedRow] = await db
    .update(tasks)
    .set({
      setupStatus: status,
      setupError: message,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  if (updatedRow) return updatedRow;
  const row = await loadTaskRow(taskId);
  if (row) return row;
  if (fallbackRow) return { ...fallbackRow, setupStatus: status, setupError: message };
  throw new Error(message);
}

async function loadTaskRow(taskId: string): Promise<TaskRow | undefined> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return row;
}

async function applyBackgroundTaskNaming(input: {
  namingPromise: ReturnType<typeof generateTaskNames>;
  project: ProjectProvider;
  projectId: string;
  taskId: string;
  initialConversationId?: string;
}): Promise<void> {
  const naming = await input.namingPromise;
  if (!naming.success || !naming.taskName) {
    log.warn('createTask: background session naming did not produce a title', {
      taskId: input.taskId,
      projectId: input.projectId,
      success: naming.success,
      message: naming.success ? undefined : naming.message,
    });
    return;
  }
  const sessionTitle = naming.taskName;

  // The generated title belongs to the session: rename the conversation first,
  // then let the task name follow it. Our title overrides the provider CLI's
  // interim auto-title ('agent'), but never a manual rename ('user').
  if (input.initialConversationId) {
    const [conversation] = await db
      .select({ titleSource: conversations.titleSource })
      .from(conversations)
      .where(eq(conversations.id, input.initialConversationId))
      .limit(1);
    if (conversation && conversation.titleSource !== 'user') {
      await renameConversation(input.initialConversationId, sessionTitle, 'yoda');
    }
  }

  const taskSettings = await appSettingsService.get('tasks');
  const row = await loadTaskRow(input.taskId);
  if (!row) return;
  if (row.isUserNamed) {
    log.info('createTask: skipping task-name init because task is user named', {
      taskId: input.taskId,
      projectId: input.projectId,
    });
    return;
  }

  // 'ai' branch naming: the session naming call also returned a semantic slug —
  // rename the placeholder branch to it. 'hash' mode never produces one.
  let nextBranch = row.taskBranch;
  if (naming.branchName) {
    const branchRename = await renameTaskBranchForName({
      project: input.project,
      projectId: input.projectId,
      taskId: input.taskId,
      oldBranch: row.taskBranch,
      sourceBranch: row.sourceBranch,
      displayName: naming.branchName,
    });
    if (branchRename.success) {
      nextBranch = branchRename.data ?? row.taskBranch;
    } else {
      log.warn('createTask: background task branch rename failed', {
        taskId: input.taskId,
        projectId: input.projectId,
        error: branchRename.error,
      });
    }
  }

  const nextName = taskSettings.initTaskNameFromSession ? sessionTitle : row.name;
  if (nextName === row.name && nextBranch === row.taskBranch) return;

  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: nextName,
      taskBranch: nextBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, input.taskId))
    .returning();
  const task = mapTaskRowToTask(updatedRow ?? { ...row, name: nextName, taskBranch: nextBranch });
  taskEvents._emit('task:updated', task);
  if (nextName !== row.name) {
    events.emit(taskRenamedChannel, {
      taskId: input.taskId,
      projectId: input.projectId,
      name: nextName,
      isUserNamed: task.isUserNamed,
    });
  }
}

async function setupBranch(options: {
  project: ProjectProvider;
  params: CreateTaskParams;
  dbSourceBranch: CreateTaskParams['sourceBranch'];
  branchSeedName: string | undefined;
  branchPrefix: string;
  suffix: string;
  configuredRemote: string;
}): Promise<BranchSetupResult> {
  const {
    project,
    params,
    dbSourceBranch,
    branchSeedName,
    branchPrefix,
    suffix,
    configuredRemote,
  } = options;
  const { strategy } = params;

  switch (strategy.kind) {
    case 'new-branch': {
      const rawBranch =
        deriveTaskSlug(branchSeedName ?? strategy.taskBranch) || strategy.taskBranch;
      const taskBranch = resolveTaskBranchName({
        rawBranch,
        branchPrefix,
        suffix,
        linkedIssue: params.linkedIssue,
      });
      const repoInfo = await project.repository.getRepositoryInfo();
      if (repoInfo.isUnborn) {
        return {
          success: false,
          branch: repoInfo.currentBranch ?? dbSourceBranch.branch,
          message: 'Create an initial commit to enable branch-based tasks.',
        };
      }
      const createResult = await project.repository.createBranch(
        taskBranch,
        dbSourceBranch.branch,
        dbSourceBranch.type === 'remote',
        dbSourceBranch.type === 'remote' ? dbSourceBranch.remote.name : undefined
      );
      if (!createResult.success) {
        return {
          success: false,
          branch: taskBranch,
          message: formatCreateBranchError(createResult.error),
        };
      }
      if (strategy.pushBranch) {
        const publishResult = await project.repository.publishBranch(taskBranch, configuredRemote);
        if (!publishResult.success) {
          return {
            success: true,
            taskBranch,
            warning: {
              type: 'branch-publish-failed',
              branch: taskBranch,
              remote: configuredRemote,
              error: publishResult.error,
            },
          };
        }
      }
      return { success: true, taskBranch };
    }

    case 'checkout-existing':
      return { success: true, taskBranch: dbSourceBranch.branch };

    case 'from-pull-request': {
      if (strategy.taskBranch) {
        const rawBranch =
          deriveTaskSlug(branchSeedName ?? strategy.taskBranch) || strategy.taskBranch;
        const taskBranch = resolveTaskBranchName({
          rawBranch,
          branchPrefix,
          suffix,
        });
        const createResult = await project.repository.createBranch(
          taskBranch,
          strategy.headBranch,
          false
        );
        if (!createResult.success) {
          return {
            success: false,
            branch: taskBranch,
            message: formatCreateBranchError(createResult.error),
          };
        }
        if (strategy.pushBranch) {
          const publishResult = await project.repository.publishBranch(
            taskBranch,
            configuredRemote
          );
          if (!publishResult.success) {
            return {
              success: true,
              taskBranch,
              warning: {
                type: 'branch-publish-failed',
                branch: taskBranch,
                remote: configuredRemote,
                error: publishResult.error,
              },
            };
          }
        }
        return { success: true, taskBranch };
      }
      return { success: true, taskBranch: strategy.headBranch };
    }

    case 'no-worktree':
      return { success: true, taskBranch: undefined };
  }
}

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const { strategy } = params;
  const suffix = Math.random().toString(36).slice(2, 7);
  const [projectSettings, taskSettings, runtimeAutoApproveDefaults] = await Promise.all([
    appSettingsService.get('project'),
    appSettingsService.get('tasks'),
    appSettingsService.get('runtimeAutoApproveDefaults'),
  ]);
  const branchPrefix = projectSettings.branchPrefix ?? '';
  let warning: CreateTaskWarning | undefined;

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  const [, configuredRemote] = await Promise.all([
    project.repository.getRemotes(),
    project.repository.getConfiguredRemote(),
  ]);

  // sourceBranch stored in the DB — defaults to params.sourceBranch but overridden for PRs.
  let dbSourceBranch = params.sourceBranch;

  if (strategy.kind === 'from-pull-request') {
    // If the head branch is already checked out in a valid worktree, skip the fetch.
    // Git refuses to update a branch that is currently checked out, even with --force.
    const existingWorktree = await project.getWorktreeForBranch(strategy.headBranch);

    if (!existingWorktree) {
      // Fetch the PR head — handles same-repo and fork PRs.
      // Uses headRefName directly as the local branch name (same as `gh pr checkout`).
      const fetchResult = await project.repository.fetchPrForReview(
        strategy.prNumber,
        strategy.headBranch,
        strategy.headRepositoryUrl,
        strategy.headBranch,
        strategy.isFork,
        configuredRemote
      );
      if (!fetchResult.success) {
        return err({
          type: 'pr-fetch-failed',
          error: fetchResult.error,
          remote: configuredRemote,
        });
      }
    }

    dbSourceBranch = { type: 'local', branch: strategy.headBranch };
  }

  const initialStatus: TaskLifecycleStatus = params.initialStatus ?? 'in_progress';
  const setupData = JSON.stringify({
    params: {
      ...params,
      sourceBranch: dbSourceBranch,
    },
  });

  // Subtask parent: validate it exists in the same project; degrade to a top-level
  // task instead of failing creation when the parent is gone or mismatched.
  let parentTaskId: string | null = null;
  if (params.parentTaskId) {
    const [parent] = await db
      .select({ id: tasks.id, projectId: tasks.projectId, archivedAt: tasks.archivedAt })
      .from(tasks)
      .where(eq(tasks.id, params.parentTaskId))
      .limit(1);
    if (parent && parent.projectId === params.projectId && !parent.archivedAt) {
      parentTaskId = parent.id;
    }
  }

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id: params.id,
      projectId: params.projectId,
      name: params.name,
      status: initialStatus,
      sourceBranch: toStoredBranch(dbSourceBranch),
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      workspaceProvider: params.workspaceProvider ?? null,
      sidebarWorkspaceId: params.sidebarWorkspaceId ?? null,
      parentTaskId,
      setupStatus: 'pending',
      setupData,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  let prs: Awaited<ReturnType<typeof prQueryService.getTaskPullRequests>> = [];
  if (strategy.kind === 'from-pull-request') {
    const capability = await prQueryService.getProjectRemoteInfo(params.projectId);
    if (capability.status === 'ready') {
      prs = await prQueryService.getTaskPullRequests(
        params.projectId,
        strategy.headBranch,
        capability.repositoryUrl
      );
    }
  }

  if (params.linkedIssue) {
    await replaceTaskIssueLinks(params.id, [params.linkedIssue]);
  }

  const linkedIssues = params.linkedIssue ? [params.linkedIssue] : undefined;
  const initialTask = mapTaskRowToTask(taskRow, prs, {}, linkedIssues);

  taskEvents._emit('task:created', initialTask);

  const displayName = params.name;
  // Only auto-name when there is real content to name from. A blank submit has no
  // initial prompt, so naming would otherwise run against the random placeholder
  // name and surface that slug as the "First user prompt" — the user can trigger
  // naming manually later once the task has content.
  const hasInitialPrompt = Boolean(params.initialConversation?.initialPrompt?.trim());
  const shouldGenerate = taskSettings.autoGenerateName && hasInitialPrompt;
  // When auto-naming owns the branch: 'hash' mode bakes a short time hash into
  // the seed up front; 'ai' mode keeps the placeholder seed and renames the
  // branch in the background once the naming agent returns a semantic slug.
  const autoNamesBranch = shouldGenerate && createTaskStrategyRequiresBranchName(strategy);
  const branchSeedName =
    autoNamesBranch && taskSettings.branchNaming === 'hash'
      ? timeBranchSeed()
      : branchSeed(strategy);
  const namingPromise = shouldGenerate
    ? generateTaskNames({
        taskId: params.id,
        projectId: params.projectId,
        project,
        params: { ...params, sourceBranch: dbSourceBranch },
        includeBranchName: autoNamesBranch && taskSettings.branchNaming === 'ai',
        target: 'session',
      })
    : null;
  if (namingPromise) {
    void namingPromise.catch((error: unknown) => {
      log.warn('createTask: background task naming failed', {
        taskId: params.id,
        projectId: params.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  const branchSetup = await setupBranch({
    project,
    params,
    dbSourceBranch,
    branchSeedName,
    branchPrefix,
    suffix,
    configuredRemote,
  });
  if (!branchSetup.success) {
    const failedRow = await markSetupFailure(
      params.id,
      'branch_failed',
      branchSetup.message,
      taskRow
    );
    return ok({
      task: mapTaskRowToTask(failedRow, prs, {}, linkedIssues),
      warning: {
        type: 'branch-setup-failed',
        branch: branchSetup.branch,
        message: branchSetup.message,
      },
    });
  }
  if (branchSetup.warning) warning = branchSetup.warning;

  const [updatedReadyRow] = await db
    .update(tasks)
    .set({
      name: displayName,
      taskBranch: branchSetup.taskBranch ?? null,
      setupStatus: 'ready',
      setupError: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, params.id))
    .returning();
  const readyRow =
    updatedReadyRow ??
    (await loadTaskRow(params.id)) ??
    ({
      ...taskRow,
      name: displayName,
      taskBranch: branchSetup.taskBranch ?? null,
      setupStatus: 'ready',
      setupError: null,
    } satisfies TaskRow);
  const task = mapTaskRowToTask(readyRow, prs, {}, linkedIssues);
  taskEvents._emit('task:updated', task);

  const provisionResult = await taskManager.provisionTask(project, task, [], []);
  if (!provisionResult.success) {
    return err(mapProvisionError(provisionResult.error));
  }
  telemetryService.capture('task_provisioned', {
    project_id: params.projectId,
    task_id: params.id,
  });

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      isInitialConversation: true,
      autoApprove: resolveAgentAutoApprove(
        params.initialConversation.autoApprove,
        runtimeAutoApproveDefaults,
        params.initialConversation.runtime
      ),
    });
  }
  if (namingPromise) {
    void applyBackgroundTaskNaming({
      namingPromise,
      project,
      projectId: params.projectId,
      taskId: params.id,
      initialConversationId: params.initialConversation?.id,
    });
  }

  const taskCreatedStrategy = (() => {
    if (strategy.kind === 'from-pull-request') return 'pr';
    if (params.linkedIssue) return 'issue';
    if (strategy.kind === 'no-worktree') return 'blank';
    return 'branch';
  })();

  telemetryService.capture('task_created', {
    strategy: taskCreatedStrategy,
    has_initial_prompt: Boolean(params.initialConversation?.initialPrompt?.trim()),
    has_issue: params.linkedIssue?.provider ?? 'none',
    provider: params.initialConversation?.runtime ?? null,
    project_id: params.projectId,
    task_id: params.id,
  });
  if (params.linkedIssue) {
    telemetryService.capture('issue_linked_to_task', {
      provider: params.linkedIssue.provider,
      project_id: params.projectId,
      task_id: params.id,
    });
  }

  return ok({ task, warning });
}

export async function retryTaskSetup(
  projectId: string,
  taskId: string,
  manualBranchName?: string
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) return err({ type: 'project-not-found' });
  const project = projectManager.getProject(projectId);
  if (!project) return err({ type: 'project-not-found' });

  const parsed = parseSetupData(row.setupData);
  if (!parsed) {
    const failedRow = await markSetupFailure(
      taskId,
      'naming_failed',
      'No setup data is available for this task.',
      row
    );
    return ok({
      task: mapTaskRowToTask(failedRow),
      warning: {
        type: 'task-naming-failed',
        message: 'No setup data is available for this task.',
        blocksProvision: true,
      },
    });
  }

  const params: CreateTaskParams = {
    ...parsed.params,
    id: taskId,
    projectId,
    name: row.name,
  };
  const [projectSettings, taskSettings, runtimeAutoApproveDefaults, configuredRemote] =
    await Promise.all([
      appSettingsService.get('project'),
      appSettingsService.get('tasks'),
      appSettingsService.get('runtimeAutoApproveDefaults'),
      project.repository.getConfiguredRemote(),
    ]);
  const branchPrefix = projectSettings.branchPrefix ?? '';
  const suffix = Math.random().toString(36).slice(2, 7);
  let warning: CreateTaskWarning | undefined;
  let dbSourceBranch = params.sourceBranch;

  if (params.strategy.kind === 'from-pull-request') {
    const existingWorktree = await project.getWorktreeForBranch(params.strategy.headBranch);
    if (!existingWorktree) {
      const fetchResult = await project.repository.fetchPrForReview(
        params.strategy.prNumber,
        params.strategy.headBranch,
        params.strategy.headRepositoryUrl,
        params.strategy.headBranch,
        params.strategy.isFork,
        configuredRemote
      );
      if (!fetchResult.success) {
        return err({
          type: 'pr-fetch-failed',
          error: fetchResult.error,
          remote: configuredRemote,
        });
      }
    }
    dbSourceBranch = { type: 'local', branch: params.strategy.headBranch };
  }

  const displayName = row.name;
  const hasInitialPrompt = Boolean(params.initialConversation?.initialPrompt?.trim());
  const shouldGenerate = taskSettings.autoGenerateName && hasInitialPrompt;
  // Naming runs in the background and never blocks provisioning. 'hash' branch
  // naming bakes a time hash into the seed; 'ai' renames the branch later.
  const autoNamesBranch =
    !manualBranchName?.trim() &&
    taskSettings.autoGenerateName &&
    createTaskStrategyRequiresBranchName(params.strategy);
  const nextBranchSeed =
    manualBranchName?.trim() ||
    (autoNamesBranch && taskSettings.branchNaming === 'hash'
      ? timeBranchSeed()
      : branchSeed(params.strategy));

  const branchSetup = await setupBranch({
    project,
    params,
    dbSourceBranch,
    branchSeedName: nextBranchSeed,
    branchPrefix,
    suffix,
    configuredRemote,
  });
  if (!branchSetup.success) {
    const failedRow = await markSetupFailure(taskId, 'branch_failed', branchSetup.message, row);
    return ok({
      task: mapTaskRowToTask(failedRow),
      warning: {
        type: 'branch-setup-failed',
        branch: branchSetup.branch,
        message: branchSetup.message,
      },
    });
  }
  if (branchSetup.warning) warning = branchSetup.warning;

  const [updatedReadyRow] = await db
    .update(tasks)
    .set({
      name: displayName,
      sourceBranch: toStoredBranch(dbSourceBranch),
      taskBranch: branchSetup.taskBranch ?? null,
      setupStatus: 'ready',
      setupError: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();
  const readyRow =
    updatedReadyRow ??
    (await loadTaskRow(taskId)) ??
    ({
      ...row,
      name: displayName,
      sourceBranch: toStoredBranch(dbSourceBranch),
      taskBranch: branchSetup.taskBranch ?? null,
      setupStatus: 'ready',
      setupError: null,
    } satisfies TaskRow);

  const task = mapTaskRowToTask(readyRow);
  taskEvents._emit('task:updated', task);
  const provisionResult = await taskManager.provisionTask(project, task, [], []);
  if (!provisionResult.success) return err(mapProvisionError(provisionResult.error));

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      isInitialConversation: true,
      autoApprove: resolveAgentAutoApprove(
        params.initialConversation.autoApprove,
        runtimeAutoApproveDefaults,
        params.initialConversation.runtime
      ),
    });
  }

  if (shouldGenerate) {
    void applyBackgroundTaskNaming({
      namingPromise: generateTaskNames({
        taskId,
        projectId,
        project,
        params: { ...params, sourceBranch: dbSourceBranch },
        includeBranchName: autoNamesBranch && taskSettings.branchNaming === 'ai',
        target: 'session',
      }),
      project,
      projectId,
      taskId,
      initialConversationId: params.initialConversation?.id,
    });
  }

  return ok({ task, warning });
}

function parseSetupData(value: string | null): { params: CreateTaskParams } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { params?: CreateTaskParams };
    return parsed.params ? { params: parsed.params } : null;
  } catch {
    return null;
  }
}
