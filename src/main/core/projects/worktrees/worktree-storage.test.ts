import { describe, expect, it } from 'vitest';
import { parseWorktreePorcelain } from './worktree-storage-parse';
import { groupActiveTasksByBranch, isWorktreeReclaimable } from './worktree-task-references';

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
      { path: '/repo', branch: 'main', head: 'abc' },
      { path: '/worktrees/task-one', branch: 'yoda/task-one', head: 'def' },
      { path: '/worktrees/detached', branch: null, head: '123' },
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

describe('isWorktreeReclaimable', () => {
  it('never marks a detached HEAD worktree as reclaimable', () => {
    expect(
      isWorktreeReclaimable({
        branch: null,
        dirty: false,
        inspectionPending: false,
        referencedByActiveTask: false,
      })
    ).toBe(false);
  });

  it.each([
    { dirty: true, inspectionPending: false, referencedByActiveTask: false },
    { dirty: false, inspectionPending: true, referencedByActiveTask: false },
    { dirty: false, inspectionPending: false, referencedByActiveTask: true },
  ])('fails closed while worktree safety is uncertain: %o', (state) => {
    expect(isWorktreeReclaimable({ branch: 'yoda/task', ...state })).toBe(false);
  });

  it('allows a clean, fully inspected, unreferenced branch worktree', () => {
    expect(
      isWorktreeReclaimable({
        branch: 'yoda/task',
        dirty: false,
        inspectionPending: false,
        referencedByActiveTask: false,
      })
    ).toBe(true);
  });
});
