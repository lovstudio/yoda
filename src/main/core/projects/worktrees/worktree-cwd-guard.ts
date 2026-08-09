import { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  listTmuxSessionMarkersStrict,
  type TmuxSessionMarker,
} from '@main/core/pty/tmux-session-name';

type TmuxCwdGuardDependencies = {
  listMarkers: (ctx: IExecutionContext) => Promise<TmuxSessionMarker[]>;
  realPath: (targetPath: string) => Promise<string>;
};

function isSameOrDescendant(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Fail closed if a canonical Yoda tmux pane still has this worktree as its cwd. */
export async function assertNoTmuxSessionUsesWorktree(
  ctx: IExecutionContext,
  worktreePath: string,
  dependencies: Partial<TmuxCwdGuardDependencies> = {}
): Promise<void> {
  const listMarkers = dependencies.listMarkers ?? listTmuxSessionMarkersStrict;
  const realPath = dependencies.realPath ?? fsPromises.realpath;
  const [markers, realWorktreePath] = await Promise.all([listMarkers(ctx), realPath(worktreePath)]);
  const lexicalWorktreePath = path.resolve(worktreePath);

  for (const marker of markers) {
    if (!marker.cwd || !path.isAbsolute(marker.cwd)) {
      throw new Error(`Cannot verify cwd for tmux session ${marker.sessionName}`);
    }

    const lexicalCwd = path.resolve(marker.cwd);
    const realCwd = await realPath(marker.cwd).catch(() => lexicalCwd);
    if (
      isSameOrDescendant(lexicalWorktreePath, lexicalCwd) ||
      isSameOrDescendant(realWorktreePath, realCwd)
    ) {
      throw new Error(
        `Worktree is still used as cwd by tmux session ${marker.sessionName}: ${marker.cwd}`
      );
    }
  }
}
