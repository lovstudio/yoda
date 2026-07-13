import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { LocalProject, SshProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { MoveTaskToProjectError, Task } from '@shared/tasks';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import {
  conversations,
  reviewOrchestrations,
  taskNamingSnapshots,
  tasks,
  teamRooms,
  terminals,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { toStoredBranch } from '../stored-branch';

/** execFile rejections carry stderr/stdout — surface those over the bare message. */
function gitErrorDetail(e: unknown): string {
  const error = e as { stderr?: string; stdout?: string; message?: string };
  return (
    [error.stderr?.trim(), error.stdout?.trim()].filter(Boolean).join('\n') ||
    error.message ||
    String(e)
  );
}

/**
 * Re-home a task under a different project ("move", or "promote" a projectless
 * Default task into a real project).
 *
 * Two paths:
 * - No-worktree leaf task: a lightweight DB re-home — just reassign `projectId`
 *   across the task and its task-scoped rows; it re-provisions fresh in the
 *   destination.
 * - Worktree task: a full migration. The task's branch (with all commits, plus
 *   any uncommitted work committed first) is transferred into the destination
 *   repo via a temporary git bundle, the source worktree/branch are torn down,
 *   and the task re-points its base at the destination's default branch so it
 *   re-provisions a fresh worktree on the migrated branch there.
 *
 * Subtrees are never split — tasks with subtasks are rejected. The task's prior
 * on-disk agent transcript (keyed by working directory) does not follow; the
 * caller warns the user.
 */
export async function moveTaskToProject(
  taskId: string,
  targetProjectId: string
): Promise<Result<Task, MoveTaskToProjectError>> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return err({ type: 'task-not-found' });
  if (task.projectId === targetProjectId) return err({ type: 'same-project' });

  const targetProject = await getProjectById(targetProjectId);
  if (!targetProject) return err({ type: 'project-not-found' });

  // A subtree would straddle two projects — that's the heavier "split" not
  // covered here.
  const [child] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.parentTaskId, taskId))
    .limit(1);
  if (child) return err({ type: 'has-subtasks' });

  // Worktree tasks need their branch migrated into the destination repo before
  // the rows move; no-worktree tasks just re-home.
  let sourceBranchReset: string | undefined;
  if (task.taskBranch) {
    const migrate = await migrateWorktreeBranch(
      taskId,
      task.taskBranch,
      task.projectId,
      targetProject
    );
    if (!migrate.success) {
      log.warn('moveTaskToProject: worktree migration failed', {
        taskId,
        targetProjectId,
        error: migrate.error,
      });
      return migrate;
    }
    sourceBranchReset = migrate.data.targetBaseBranch;
  } else if (projectManager.getProject(task.projectId)) {
    // Stop any live session running in the old project context before the rows
    // move; the task re-provisions on demand in the destination.
    await teardownSourceTask(taskId);
  }

  // Reassign the task and every task-scoped row that carries its own projectId,
  // so per-(project, task) lookups resolve under the new project. A migrated
  // worktree repoints its base at the destination's default branch; clear the
  // old workspace/parent bindings either way.
  await db
    .update(tasks)
    .set({
      projectId: targetProjectId,
      parentTaskId: null,
      sidebarWorkspaceId: null,
      workspaceId: null,
      workspaceProviderData: null,
      ...(task.taskBranch
        ? {
            sourceBranch: sourceBranchReset
              ? toStoredBranch({ type: 'local', branch: sourceBranchReset })
              : null,
          }
        : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  await db
    .update(conversations)
    .set({ projectId: targetProjectId })
    .where(eq(conversations.taskId, taskId));
  await db
    .update(terminals)
    .set({ projectId: targetProjectId })
    .where(eq(terminals.taskId, taskId));
  await db
    .update(taskNamingSnapshots)
    .set({ projectId: targetProjectId })
    .where(eq(taskNamingSnapshots.taskId, taskId));
  await db
    .update(reviewOrchestrations)
    .set({ projectId: targetProjectId })
    .where(eq(reviewOrchestrations.taskId, taskId));
  await db
    .update(teamRooms)
    .set({ projectId: targetProjectId })
    .where(eq(teamRooms.taskId, taskId));

  const [updatedRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const updated = mapTaskRowToTask(updatedRow);
  taskEvents._emit('task:updated', updated);
  telemetryService.capture('task_moved_to_project', {
    task_id: taskId,
    from_project_id: task.projectId,
    to_project_id: targetProjectId,
    with_worktree: Boolean(task.taskBranch),
  });
  return ok(updated);
}

async function teardownSourceTask(taskId: string): Promise<void> {
  const teardown = await taskManager.teardownTask(taskId, 'terminate').catch((e) => {
    log.warn('moveTaskToProject: teardown failed', { taskId, error: String(e) });
    return null;
  });
  if (teardown && !teardown.success) {
    log.warn('moveTaskToProject: teardown failed', { taskId, error: teardown.error.message });
  }
}

/**
 * Transfer a task's branch into the destination repo, then tear down the source
 * worktree/branch. Returns the destination's default branch so the caller can
 * repoint the task's base for future re-provisioning and merges.
 */
async function migrateWorktreeBranch(
  taskId: string,
  taskBranch: string,
  sourceProjectId: string,
  targetProject: LocalProject | SshProject
): Promise<Result<{ targetBaseBranch: string | undefined }, MoveTaskToProjectError>> {
  const source = projectManager.getProject(sourceProjectId);
  if (!source) return err({ type: 'source-project-not-open' });

  const targetResult = await getOpenTargetProject(targetProject);
  if (!targetResult.success) return targetResult;
  const target = targetResult.data;

  const sourceGit = (args: string[]) => source.ctx.exec('git', args);
  const targetGit = (args: string[]) => target.ctx.exec('git', args);

  // The destination must be a git repo to receive the branch — several
  // registered projects (incl. the internal Default) have no git.
  const targetIsRepo = await targetGit(['-C', target.repoPath, 'rev-parse', '--git-dir'])
    .then(() => true)
    .catch(() => false);
  if (!targetIsRepo) return err({ type: 'target-not-git' });

  try {
    // 1) Commit any uncommitted work in the worktree so the push carries it.
    const worktreePath = await source.getWorktreeForBranch(taskBranch);
    if (worktreePath) {
      const { stdout } = await sourceGit(['-C', worktreePath, 'status', '--porcelain']);
      if (stdout.trim()) {
        await sourceGit(['-C', worktreePath, 'add', '-A']);
        await sourceGit([
          '-C',
          worktreePath,
          ...(await commitIdentityArgs(sourceGit, worktreePath)),
          'commit',
          // Skip the repo's pre-commit hooks: this is an internal WIP snapshot
          // for migration, not a user commit — lint/format hooks must not be
          // able to abort (or hang) the move.
          '--no-verify',
          '-m',
          'Snapshot before moving to another project',
        ]);
      }
    }

    // 2) Only push if the branch actually exists in the source repo.
    const branchExists = await sourceGit([
      '-C',
      source.repoPath,
      'rev-parse',
      '--verify',
      `refs/heads/${taskBranch}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (branchExists) {
      await transferBranchBundle(source, target, taskBranch);
    }

    // 3) Resolve the destination's default branch (best-effort) so the task can
    //    repoint its base there.
    const targetBaseBranch = await resolveDefaultBranch(targetGit, target.repoPath);

    // 4) Tear down the source session/worktree, then drop the source branch.
    await teardownSourceTask(taskId);
    if (branchExists) {
      await sourceGit(['-C', source.repoPath, 'branch', '-D', taskBranch]).catch((e: unknown) => {
        log.warn('moveTaskToProject: failed to delete source branch', {
          taskBranch,
          error: String(e),
        });
      });
    }

    return ok({ targetBaseBranch });
  } catch (e) {
    return err({ type: 'git-error', detail: gitErrorDetail(e) });
  }
}

async function getOpenTargetProject(
  project: LocalProject | SshProject
): Promise<Result<ProjectProvider, MoveTaskToProjectError>> {
  const existing = projectManager.getProject(project.id);
  if (existing) return ok(existing);

  const opened = await projectManager.openProject(project);
  if (opened.success) return ok(opened.data);

  return err({
    type: 'git-error',
    detail: `Target project could not be opened: ${opened.error.message}`,
  });
}

async function transferBranchBundle(
  source: ProjectProvider,
  target: ProjectProvider,
  taskBranch: string
): Promise<void> {
  const transferId = randomUUID();
  const sourceTempDir = `.yoda/tmp/move-${transferId}-source`;
  const targetTempDir = `.yoda/tmp/move-${transferId}-target`;
  const sourceBundlePath = `${sourceTempDir}/branch.bundle`;
  const targetBundlePath = `${targetTempDir}/branch.bundle`;
  const localTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yoda-move-'));
  const localBundlePath = path.join(localTempDir, 'branch.bundle');

  try {
    await source.fs.mkdir(sourceTempDir, { recursive: true });
    await source.ctx.exec('git', [
      '-C',
      source.repoPath,
      'bundle',
      'create',
      sourceBundlePath,
      `refs/heads/${taskBranch}`,
    ]);
    await copyProviderFileToLocal(source, sourceBundlePath, localBundlePath);

    await target.fs.mkdir(targetTempDir, { recursive: true });
    await copyLocalFileToProvider(target, localBundlePath, targetBundlePath);
    await target.ctx.exec('git', [
      '-C',
      target.repoPath,
      'fetch',
      targetBundlePath,
      `+refs/heads/${taskBranch}:refs/heads/${taskBranch}`,
    ]);
  } finally {
    await Promise.allSettled([
      source.fs.remove(sourceTempDir, { recursive: true }),
      target.fs.remove(targetTempDir, { recursive: true }),
      fs.rm(localTempDir, { recursive: true, force: true }),
    ]);
  }
}

async function copyProviderFileToLocal(
  provider: ProjectProvider,
  srcRelPath: string,
  localAbsPath: string
): Promise<void> {
  if (!provider.fs.copyToLocalFile) {
    throw new Error(
      `Project transport "${provider.type}" cannot copy files to local temp storage.`
    );
  }
  await provider.fs.copyToLocalFile(srcRelPath, localAbsPath);
}

async function copyLocalFileToProvider(
  provider: ProjectProvider,
  localAbsPath: string,
  destRelPath: string
): Promise<void> {
  if (!provider.fs.copyLocalFile) {
    throw new Error(`Project transport "${provider.type}" cannot copy local temp files.`);
  }
  await provider.fs.copyLocalFile(localAbsPath, destRelPath);
}

/** `git -c user.name=… -c user.email=…` only when the worktree has no identity. */
async function commitIdentityArgs(
  git: (args: string[]) => Promise<{ stdout: string }>,
  worktreePath: string
): Promise<string[]> {
  const email = await git(['-C', worktreePath, 'config', 'user.email'])
    .then((r) => r.stdout.trim())
    .catch(() => '');
  return email ? [] : ['-c', 'user.name=Yoda', '-c', 'user.email=yoda@lovstudio.ai'];
}

async function resolveDefaultBranch(
  git: (args: string[]) => Promise<{ stdout: string }>,
  repoPath: string
): Promise<string | undefined> {
  const branch = await git(['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'])
    .then((r) => r.stdout.trim())
    .catch(() => '');
  return branch || undefined;
}
