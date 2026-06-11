import { homedir } from 'node:os';
import path from 'node:path';

export const WORKTREE_POOL_DIR_NAME = 'worktrees';
export const LOCAL_WORKTREE_ROOT_DIR_NAME = 'Yoda';
export const SSH_PROJECT_STATE_DIR_NAME = '.yoda';
export const PROJECT_LOCAL_WORKTREES_DIR_NAME = '.worktrees';

export function getDefaultLocalWorktreeDirectory(homeDirectory: string = homedir()): string {
  return path.join(homeDirectory, LOCAL_WORKTREE_ROOT_DIR_NAME, WORKTREE_POOL_DIR_NAME);
}

export function getProjectLocalWorktreeDirectory(projectPath: string): string {
  return path.join(projectPath, PROJECT_LOCAL_WORKTREES_DIR_NAME);
}

export function getDefaultSshWorktreeDirectory(projectPath: string): string {
  return path.posix.join(projectPath, SSH_PROJECT_STATE_DIR_NAME, WORKTREE_POOL_DIR_NAME);
}
