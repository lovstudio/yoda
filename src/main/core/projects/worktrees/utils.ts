import fs from 'fs';
import path from 'path';
import type { Task } from '@shared/tasks';
import type { FileSystemProvider } from '@main/core/fs/types';
import { mapWorktreeErrorToProvisionError } from '../../tasks/provision-task-error';
import type { WorktreeService } from './worktree-service';

export const ensureLocalWorktreeDirectory = ({
  directory,
  projectName,
}: {
  directory?: string;
  projectName: string;
}): string => {
  directory = directory ?? path.join('yoda', 'projects', 'worktrees', projectName);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return directory;
};

export const ensureSshWorktreeDirectory = async ({
  directory,
  projectName,
  rootFs,
}: {
  directory?: string;
  projectName: string;
  rootFs: FileSystemProvider;
}): Promise<string> => {
  directory = directory ?? path.join('yoda', 'projects', 'worktrees', projectName);

  const exists = await rootFs.exists(directory);
  if (!exists) {
    await rootFs.mkdir(directory, { recursive: true });
  }
  return directory;
};

export async function resolveTaskWorkDir(
  task: Pick<Task, 'taskBranch' | 'sourceBranch' | 'workspaceId'>,
  projectPath: string,
  worktreeService: WorktreeService
): Promise<string> {
  if (!task.taskBranch) return projectPath;

  // workspaceId is written only after a task has provisioned successfully.
  // On a later renderer-cold open, allow that persisted task to reuse the
  // project-root checkout too. Otherwise a task on `main` falls through to
  // checkoutExistingBranch(), whose best-effort remote fetch can add seconds
  // to every task switch despite the local checkout already being ready.
  const existing = task.workspaceId
    ? await worktreeService.getWorktree(task.taskBranch, { includeProjectRoot: true })
    : await worktreeService.getWorktree(task.taskBranch);
  if (existing) return existing;

  if (!task.sourceBranch || task.taskBranch === task.sourceBranch.branch) {
    const result = await worktreeService.checkoutExistingBranch(task.taskBranch, task.sourceBranch);
    if (!result.success) throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
    return result.data;
  }

  const result = await worktreeService.checkoutBranchWorktree(task.sourceBranch, task.taskBranch);
  if (!result.success) throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
  return result.data;
}
