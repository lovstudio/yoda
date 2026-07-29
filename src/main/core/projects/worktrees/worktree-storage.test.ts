import { describe, expect, it } from 'vitest';
import { parseWorktreePorcelain } from './worktree-storage-parse';
import { groupActiveTasksByBranch } from './worktree-task-references';

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

  it('keeps the task target associated with each active worktree branch', () => {
    const grouped = groupActiveTasksByBranch([
      {
        id: 'task-1',
        name: 'Resource center',
        projectId: 'project-1',
        taskBranch: 'feature/resources',
      },
      {
        id: 'task-2',
        name: 'Archived branchless task',
        projectId: 'project-1',
        taskBranch: null,
      },
    ]);

    expect(grouped.get('project-1')?.get('feature/resources')).toEqual({
      id: 'task-1',
      name: 'Resource center',
    });
    expect(grouped.get('project-1')?.size).toBe(1);
  });
});
