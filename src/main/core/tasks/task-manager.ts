import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { taskProvisionProgressChannel, type ProvisionStep } from '@shared/events/taskEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { Task, TaskBootstrapStatus } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { runtimeStatusMonitorRegistry } from '@main/core/conversations/runtime-status-monitor-registry';
import type { ActiveConversationSession } from '@main/core/conversations/types';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  killTmuxSessionStrict,
  listTmuxSessionMarkersStrict,
  makeTmuxSessionName,
} from '@main/core/pty/tmux-session-name';
import { getTaskSessionLeafIdPages } from '@main/core/tasks/session-targets';
import { taskEvents } from '@main/core/tasks/task-events';
import { provisionBYOITask } from '@main/core/workspaces/byoi/provision-byoi-task';
import { localWorkspaceId, sshWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import type { ProjectProvider, ProvisionResult, TaskProvider } from '../projects/project-provider';
import { TimeoutSignal, withTimeout } from '../projects/utils';
import { shouldHibernateIdleSession } from './idle-session-hibernation';
import {
  formatProvisionTaskError,
  TASK_TIMEOUT_MS,
  toProvisionError,
  toTeardownError,
  type ProvisionTaskError,
  type TeardownTaskError,
} from './provision-task-error';
import { provisionLocalTask } from './task-builder';

type StoredTask = ProvisionResult & {
  projectId: string;
  taskName: string;
  ctx: IExecutionContext;
};

export type ActiveAgentSessionSummary = {
  running: number;
  keepable: number;
  nonKeepableSessions: ActiveConversationSession[];
};

export type RunningAgentSession = ActiveConversationSession & {
  status: ReturnType<typeof agentSessionRuntimeStore.getStatus>;
  statusChangedAt: number;
};

export type TaskManagerHooks = {
  'task:provisioned': (info: {
    projectId: string;
    taskId: string;
    taskBranch: string | undefined;
    workspaceId: string;
    worktreeGitDir?: string;
  }) => void | Promise<void>;
  'task:torn-down': (info: {
    projectId: string;
    taskId: string;
    workspaceId: string;
  }) => void | Promise<void>;
};

async function executeProvision(
  provider: ProjectProvider,
  task: Task,
  conversations: Conversation[],
  terminals: Terminal[]
): Promise<ProvisionResult> {
  if (task.workspaceProvider === 'byoi') {
    const projectSettings = await provider.settings.get();
    if (projectSettings.workspaceProvider?.type !== 'script') {
      throw new Error(
        'Task has workspaceProvider=byoi but project has no script provider configured'
      );
    }
    return provisionBYOITask({
      task,
      conversations,
      terminals,
      wpConfig: projectSettings.workspaceProvider,
      ctx: provider.ctx,
      projectId: provider.projectId,
      projectPath: provider.repoPath,
      settings: provider.settings,
      logPrefix: `${provider.type}ProjectProvider[byoi]`,
    });
  }

  const workspaceId =
    provider.defaultWorkspaceType.kind === 'local'
      ? localWorkspaceId(provider.projectId, task.taskBranch)
      : sshWorkspaceId(provider.projectId, task.taskBranch);

  const { provisionResult, workspace } = await provisionLocalTask({
    task,
    conversations,
    terminals,
    workspaceId,
    type: provider.defaultWorkspaceType,
    projectId: provider.projectId,
    projectPath: provider.repoPath,
    settings: provider.settings,
    worktreeService: provider.worktreeService,
    fetchService: provider.gitFetchService,
    repository: provider.repository,
    logPrefix: `${provider.type}ProjectProvider`,
  });

  if (provider.defaultWorkspaceType.kind === 'local') {
    const mainDotGitAbs = path.resolve(provider.repoPath, '.git');
    const worktreeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
    return {
      ...provisionResult,
      persistData: { ...provisionResult.persistData, worktreeGitDir },
    };
  }

  return {
    ...provisionResult,
    persistData: {
      ...provisionResult.persistData,
      sshConnectionId: provider.defaultWorkspaceType.connectionId,
    },
  };
}

async function executeTeardown(
  task: TaskProvider,
  workspaceId: string,
  mode: TeardownMode
): Promise<void> {
  if (mode === 'detach') {
    await task.conversations.detachAll();
    await task.terminals.detachAll();
  } else {
    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
  }
  await workspaceRegistry.release(workspaceId, mode);
}

async function cleanupLateProvision(
  provision: Promise<ProvisionResult>,
  provider: ProjectProvider,
  task: Task
): Promise<void> {
  let result: ProvisionResult;
  try {
    result = await provision;
  } catch (error) {
    log.debug('TaskManager: timed-out provision eventually failed', {
      taskId: task.id,
      projectId: provider.projectId,
      error: String(error),
    });
    return;
  }

  const workspaceId = result.persistData.workspaceId;
  log.warn('TaskManager: provision completed after timeout; terminating late result', {
    taskId: task.id,
    projectId: provider.projectId,
    workspaceId,
  });

  const cleanupErrors: unknown[] = [];
  const providerCleanup = await Promise.allSettled([
    Promise.resolve().then(() => result.taskProvider.conversations.destroyAll()),
    Promise.resolve().then(() => result.taskProvider.terminals.destroyAll()),
  ]);
  for (const outcome of providerCleanup) {
    if (outcome.status === 'rejected') cleanupErrors.push(outcome.reason);
  }

  try {
    await workspaceRegistry.release(workspaceId, 'terminate');
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (cleanupErrors.length > 0) {
    await cleanupDetachedSessions(provider.projectId, task.id, provider.ctx).catch((error) => {
      cleanupErrors.push(error);
    });
    log.error('TaskManager: late provision cleanup completed with failures', {
      taskId: task.id,
      projectId: provider.projectId,
      workspaceId,
      errors: cleanupErrors.slice(0, 5).map(String),
    });
    return;
  }

  log.info('TaskManager: cleaned up provision result that completed after timeout', {
    taskId: task.id,
    projectId: provider.projectId,
    workspaceId,
  });
}

type LateProvisionGate = {
  cleanup: Promise<void>;
  error: ProvisionTaskError;
};

export const TASK_SESSION_CLEANUP_CONCURRENCY = 8;
export const TASK_SESSION_CLEANUP_KILL_TIMEOUT_MS = 5_000;
export const IDLE_SESSION_HIBERNATION_CONCURRENCY = 4;

const AUTHORITATIVE_IDLE_STATUS_MONITORS = new Set(['activity', 'transcript', 'rollout']);

function idleStatusIsAuthoritative(conversationId: string): boolean {
  const monitor = runtimeStatusMonitorRegistry.get(conversationId);
  return monitor !== undefined && AUTHORITATIVE_IDLE_STATUS_MONITORS.has(monitor);
}

export async function cleanupDetachedSessions(
  projectId: string,
  taskId: string,
  ctx: IExecutionContext,
  options: { liveTmuxSessionNames?: Set<string> } = {}
): Promise<void> {
  const liveTmuxSessionNames = new Set(
    options.liveTmuxSessionNames ??
      (await listTmuxSessionMarkersStrict(ctx)).map((marker) => marker.sessionName)
  );
  let attempted = 0;
  const killFailures: Array<{ sessionName: string; error: unknown }> = [];

  for await (const page of getTaskSessionLeafIdPages(projectId, taskId)) {
    const leafIds = [...page.conversationIds, ...page.terminalIds];
    let nextIndex = 0;
    const workerCount = Math.min(TASK_SESSION_CLEANUP_CONCURRENCY, leafIds.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < leafIds.length) {
          const leafId = leafIds[nextIndex++];
          const sessionId = makePtySessionId(projectId, taskId, leafId);
          const sessionName = makeTmuxSessionName(sessionId);
          if (!liveTmuxSessionNames.has(sessionName)) continue;
          liveTmuxSessionNames.delete(sessionName);
          attempted += 1;
          try {
            await killTmuxSessionStrict(ctx, sessionName, {
              timeout: TASK_SESSION_CLEANUP_KILL_TIMEOUT_MS,
            });
          } catch (error: unknown) {
            killFailures.push({ sessionName, error });
          }
        }
      })
    );
  }

  if (killFailures.length > 0) {
    // A pane can exit naturally between the initial list and kill. Reconcile
    // every failed kill with one fresh authoritative list so an idempotent miss
    // succeeds while transport failures and sessions that remain alive fail closed.
    const remainingSessionNames = new Set(
      (await listTmuxSessionMarkersStrict(ctx)).map((marker) => marker.sessionName)
    );
    const unresolvedFailures = killFailures.filter(({ sessionName }) =>
      remainingSessionNames.has(sessionName)
    );
    if (unresolvedFailures.length === 0) return;

    log.warn('TaskManager: fallback session cleanup completed with failures', {
      projectId,
      taskId,
      attempted,
      failed: unresolvedFailures.length,
      failureSamples: unresolvedFailures.slice(0, 5).map(({ error }) => String(error)),
    });
    throw new Error(
      `TaskManager: failed to terminate ${unresolvedFailures.length} of ${attempted} detached tmux sessions`
    );
  }
}

export class TaskManager {
  private readonly _hooks = new HookCore<TaskManagerHooks>((name, e) =>
    log.error(`TaskManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleMap<StoredTask, ProvisionTaskError>({
    postTeardown: (taskId, stored) => {
      this._tasksByProject.get(stored.projectId)?.delete(taskId);
      this._hooks.callHookBackground('task:torn-down', {
        projectId: stored.projectId,
        taskId,
        workspaceId: stored.persistData.workspaceId,
      });
    },
  });
  private readonly _tasksByProject = new Map<string, Set<string>>();
  private readonly _lateProvisionGates = new Map<string, LateProvisionGate>();
  private _idleSessionHibernation: Promise<number> | null = null;

  readonly hooks: Hookable<TaskManagerHooks> = this._hooks;

  constructor() {
    taskEvents.on('task:updated', (task) => {
      const stored = this._lifecycle.get(task.id);
      if (stored) stored.taskName = task.name;
    });
  }

  async provisionTask(
    provider: ProjectProvider,
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<ProvisionResult, ProvisionTaskError>> {
    const lateProvisionGate = this._lateProvisionGates.get(task.id);
    if (lateProvisionGate) return err(lateProvisionGate.error);

    return this._lifecycle.provision(task.id, async () => {
      let lastStep: ProvisionStep | null = null;
      const unsubscribe = events.on(taskProvisionProgressChannel, (progress) => {
        if (progress.taskId === task.id) lastStep = progress.step;
      });
      const provision = executeProvision(provider, task, conversations, terminals);
      try {
        const result = await withTimeout(provision, TASK_TIMEOUT_MS);
        const stored: StoredTask = {
          ...result,
          projectId: provider.projectId,
          taskName: task.name,
          ctx: provider.ctx,
        };

        const byProject = this._tasksByProject.get(provider.projectId) ?? new Set<string>();
        byProject.add(task.id);
        this._tasksByProject.set(provider.projectId, byProject);

        this._hooks.callHookBackground('task:provisioned', {
          projectId: provider.projectId,
          taskId: task.id,
          taskBranch: task.taskBranch,
          workspaceId: result.persistData.workspaceId,
          worktreeGitDir: result.persistData.worktreeGitDir,
        });

        return ok(stored);
      } catch (e) {
        const provisionError = toProvisionError(e, lastStep);
        if (e instanceof TimeoutSignal) {
          const cleanup = cleanupLateProvision(provision, provider, task);
          const gate: LateProvisionGate = { cleanup, error: provisionError };
          this._lateProvisionGates.set(task.id, gate);
          const clearGate = () => {
            if (this._lateProvisionGates.get(task.id) === gate) {
              this._lateProvisionGates.delete(task.id);
            }
          };
          void cleanup.then(clearGate, clearGate);
        }
        log.error('TaskManager: failed to provision task', {
          taskId: task.id,
          projectId: provider.projectId,
          error: String(e),
        });
        return err(provisionError);
      } finally {
        unsubscribe();
      }
    });
  }

  async teardownTask(
    taskId: string,
    mode: TeardownMode = 'terminate'
  ): Promise<Result<void, TeardownTaskError>> {
    const result = this._lifecycle.teardown(
      taskId,
      async ({ taskProvider, persistData, projectId, ctx }) => {
        try {
          await withTimeout(
            executeTeardown(taskProvider, persistData.workspaceId, mode),
            TASK_TIMEOUT_MS
          );
          return ok();
        } catch (e) {
          log.error('TaskManager: failed to teardown task', { taskId, error: String(e) });
          await cleanupDetachedSessions(projectId, taskId, ctx).catch((cleanupError) => {
            log.warn('TaskManager: fallback cleanup failed', {
              taskId,
              error: String(cleanupError),
            });
          });
          return err<TeardownTaskError>(toTeardownError(e));
        }
      }
    );

    return result ?? ok();
  }

  async teardownAllForProject(projectId: string, mode: TeardownMode): Promise<void> {
    const taskIds = Array.from(this._tasksByProject.get(projectId) ?? []);
    if (mode === 'detach') {
      // Detach sessions but leave workspaces alive; provider.cleanup() will call
      // workspaceRegistry.releaseAllForProject to handle workspace teardown.
      await Promise.all(
        taskIds.flatMap((id) => {
          const stored = this._lifecycle.get(id);
          if (!stored) return [];
          return [
            stored.taskProvider.conversations.detachAll(),
            stored.taskProvider.terminals.detachAll(),
          ];
        })
      );
      // Remove entries from lifecycle maps without running workspace teardown.
      this._tasksByProject.delete(projectId);
      await Promise.all(
        taskIds.map((id) => this._lifecycle.teardown(id, async () => ok()) ?? Promise.resolve(ok()))
      );
    } else {
      // teardownTask handles _tasksByProject cleanup in onFinally.
      await Promise.all(taskIds.map((id) => this.teardownTask(id, 'terminate')));
    }
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this._lifecycle.get(taskId)?.taskProvider;
  }

  getWorkspaceId(taskId: string): string | undefined {
    return this._lifecycle.get(taskId)?.persistData.workspaceId;
  }

  getRunningAgentSessions(): RunningAgentSession[] {
    return this.getAgentSessions().filter((session) => isAgentSessionRunningStatus(session.status));
  }

  getAgentSessions(): RunningAgentSession[] {
    const sessions: RunningAgentSession[] = [];
    for (const stored of this._lifecycle.values()) {
      for (const session of stored.taskProvider.conversations.getActiveSessions()) {
        const state = agentSessionRuntimeStore.getState(session);
        sessions.push({
          ...session,
          taskTitle: stored.taskName,
          status: state.status,
          statusChangedAt: state.updatedAt,
        });
      }
    }
    return sessions;
  }

  hibernateIdleAgentSessions(timeoutMs: number): Promise<number> {
    if (timeoutMs <= 0) return Promise.resolve(0);
    if (this._idleSessionHibernation) return this._idleSessionHibernation;

    // Defer the scan by one microtask so the single-flight handle is published
    // before provider callbacks can synchronously re-enter this method.
    const hibernation = Promise.resolve().then(() =>
      this.runIdleAgentSessionHibernation(timeoutMs)
    );
    this._idleSessionHibernation = hibernation;
    const clear = () => {
      if (this._idleSessionHibernation === hibernation) {
        this._idleSessionHibernation = null;
      }
    };
    void hibernation.then(clear, clear);
    return hibernation;
  }

  private async runIdleAgentSessionHibernation(timeoutMs: number): Promise<number> {
    const now = Date.now();
    const candidates: Array<{
      provider: TaskProvider['conversations'];
      conversationId: string;
      sessionId: string;
    }> = [];
    for (const stored of this._lifecycle.values()) {
      for (const session of stored.taskProvider.conversations.getActiveSessions()) {
        const state = agentSessionRuntimeStore.getState(session);
        const diagnostics = ptySessionRegistry.getDiagnostics(session.sessionId);
        if (
          !diagnostics ||
          !shouldHibernateIdleSession({
            detachable: session.detachable,
            status: state.status,
            idleStatusIsAuthoritative: idleStatusIsAuthoritative(session.conversationId),
            lastActivityAt: Math.max(
              state.updatedAt,
              diagnostics.lastOutputAt ?? 0,
              diagnostics.lastInputAt ?? 0
            ),
            now,
            timeoutMs,
            rendererConsumers: diagnostics.consumerCount,
          })
        ) {
          continue;
        }
        candidates.push({
          provider: stored.taskProvider.conversations,
          conversationId: session.conversationId,
          sessionId: session.sessionId,
        });
      }
    }
    let nextCandidateIndex = 0;
    let stopped = 0;
    const hibernateNext = async (): Promise<void> => {
      while (nextCandidateIndex < candidates.length) {
        const { provider, conversationId, sessionId } = candidates[nextCandidateIndex++];
        try {
          // The candidate scan and stop run in separate turns of the event loop.
          // Revalidate immediately before invoking stopSession so a newly opened
          // renderer or a new agent turn cannot be killed by an old snapshot.
          const current = provider
            .getActiveSessions()
            .find((session) => session.sessionId === sessionId);
          if (!current) continue;
          const state = agentSessionRuntimeStore.getState(current);
          const diagnostics = ptySessionRegistry.getDiagnostics(sessionId);
          if (
            !diagnostics ||
            !shouldHibernateIdleSession({
              detachable: current.detachable,
              status: state.status,
              idleStatusIsAuthoritative: idleStatusIsAuthoritative(current.conversationId),
              lastActivityAt: Math.max(
                state.updatedAt,
                diagnostics.lastOutputAt ?? 0,
                diagnostics.lastInputAt ?? 0
              ),
              now: Date.now(),
              timeoutMs,
              rendererConsumers: diagnostics.consumerCount,
            })
          ) {
            continue;
          }
          await provider.stopSession(conversationId);
          stopped += 1;
        } catch (error) {
          log.warn('TaskManager: failed to hibernate idle agent session', {
            conversationId,
            sessionId,
            error: String(error),
          });
        }
      }
    };
    await Promise.allSettled(
      Array.from(
        { length: Math.min(IDLE_SESSION_HIBERNATION_CONCURRENCY, candidates.length) },
        hibernateNext
      )
    );
    return stopped;
  }

  getActiveAgentSessionSummary(): ActiveAgentSessionSummary {
    const runningSessions = this.getRunningAgentSessions();
    return {
      running: runningSessions.length,
      keepable: runningSessions.filter((session) => session.detachable).length,
      nonKeepableSessions: runningSessions.filter((session) => !session.detachable),
    };
  }

  getBootstrapStatus(taskId: string): TaskBootstrapStatus {
    return this._lifecycle.bootstrapStatus(taskId, formatProvisionTaskError);
  }
}

export const taskManager = new TaskManager();
