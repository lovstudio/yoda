import { describe, expect, it } from 'vitest';
import { parseWorktreePorcelain } from './worktree-storage-parse';

describe('parseWorktreePorcelain', () => {
  it('reads branch-backed and detached worktrees', () => {
    expect(
      parseWorktreePorcelain(
        [
          'worktree /repo',
          'HEAD abc',
          'branch refs/heads/main',
          '',
          'worktree /worktrees/task-one',
          'HEAD def',
          'branch refs/heads/yoda/task-one',
          '',
          'worktree /worktrees/detached',
          'HEAD 123',
          'detached',
          '',
        ].join('\n')
      )
    ).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/worktrees/task-one', branch: 'yoda/task-one' },
      { path: '/worktrees/detached', branch: null },
    ]);
  });
});
