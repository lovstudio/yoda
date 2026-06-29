import { eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { MoveTaskToProjectError, Task } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import {
  conversations,
  projects,
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
 *   repo via `git push <sourceRepo> <targetRepoPath>`, the source worktree/branch
 *   are torn down, and the task re-points its base at the destination's default
 *   branch so it re-provisions a fresh worktree on the migrated branch there.
 *   Limited to local↔local projects for now.
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

  const [targetProject] = await db
    .select({ path: projects.path, workspaceProvider: projects.workspaceProvider })
    .from(projects)
    .where(eq(projects.id, targetProjectId))
    .limit(1);
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
    const migrate = await migrateWorktreeBranch(taskId, task.taskBranch, task.projectId, {
      path: targetProject.path,
      workspaceProvider: targetProject.workspaceProvider,
    });
    if (!migrate.success) return migrate;
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
  targetProject: { path: string; workspaceProvider: string }
): Promise<Result<{ targetBaseBranch: string | undefined }, MoveTaskToProjectError>> {
  const source = projectManager.getProject(sourceProjectId);
  if (!source) return err({ type: 'source-project-not-open' });
  // Cross-repo git surgery is local-only for now; SSH transports differ enough
  // to defer.
  if (!source.ctx.supportsLocalSpawn || targetProject.workspaceProvider !== 'local') {
    return err({ type: 'unsupported-transport' });
  }

  const git = (args: string[]) => source.ctx.exec('git', args);

  try {
    // 1) Commit any uncommitted work in the worktree so the push carries it.
    const worktreePath = await source.getWorktreeForBranch(taskBranch);
    if (worktreePath) {
      const { stdout } = await git(['-C', worktreePath, 'status', '--porcelain']);
      if (stdout.trim()) {
        await git(['-C', worktreePath, 'add', '-A']);
        await git([
          '-C',
          worktreePath,
          ...(await commitIdentityArgs(git, worktreePath)),
          'commit',
          '-m',
          'Snapshot before moving to another project',
        ]);
      }
    }

    // 2) Only push if the branch actually exists in the source repo.
    const branchExists = await git([
      '-C',
      source.repoPath,
      'rev-parse',
      '--verify',
      `refs/heads/${taskBranch}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (branchExists) {
      // Force so a re-run after a partial move still converges. taskBranch is
      // hash-unique, so this won't clobber an unrelated branch in the target.
      await git([
        '-C',
        source.repoPath,
        'push',
        targetProject.path,
        `+refs/heads/${taskBranch}:refs/heads/${taskBranch}`,
      ]);
    }

    // 3) Resolve the destination's default branch (best-effort) so the task can
    //    repoint its base there.
    const targetBaseBranch = await resolveDefaultBranch(git, targetProject.path);

    // 4) Tear down the source session/worktree, then drop the source branch.
    await teardownSourceTask(taskId);
    if (branchExists) {
      await git(['-C', source.repoPath, 'branch', '-D', taskBranch]).catch((e: unknown) => {
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
