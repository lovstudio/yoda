import { describe, expect, it } from 'vitest';
import { findHiddenPinnedTaskGroupId, limitPinnedTaskListRows } from './pinned-task-list-model';
import { type PinnedSidebarEntry } from './sidebar-store';

const projectTask = (
  projectId: string,
  taskId: string
): Extract<PinnedSidebarEntry, { kind: 'project-task' }> => ({
  kind: 'project-task',
  projectId,
  taskId,
});

const pinnedTask = (
  projectId: string,
  taskId: string
): Extract<PinnedSidebarEntry, { kind: 'task' }> => ({
  kind: 'task',
  projectId,
  taskId,
});

describe('pinned task list disclosure', () => {
  const entries: PinnedSidebarEntry[] = [
    { kind: 'project', projectId: 'project-a' },
    ...Array.from({ length: 7 }, (_, index) =>
      projectTask('project-a', `project-task-${index + 1}`)
    ),
    { kind: 'project', projectId: 'project-b' },
    projectTask('project-b', 'project-b-task'),
    ...Array.from({ length: 6 }, (_, index) => pinnedTask('project-c', `pinned-task-${index + 1}`)),
  ];

  it('limits each pinned task group while keeping project rows visible', () => {
    const rows = limitPinnedTaskListRows(entries, new Set());

    expect(rows).toEqual([
      { kind: 'project', projectId: 'project-a' },
      ...entries.slice(1, 6),
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-project-tasks::project-a',
        hiddenCount: 2,
        expanded: false,
        rowVariant: 'underProject',
      },
      { kind: 'project', projectId: 'project-b' },
      projectTask('project-b', 'project-b-task'),
      ...entries.slice(10, 15),
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 1,
        expanded: false,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('shows every task and retains the collapse control for expanded groups', () => {
    const rows = limitPinnedTaskListRows(
      entries,
      new Set(['pinned-project-tasks::project-a', 'pinned-tasks'])
    );

    expect(rows.filter((row) => row.kind === 'project-task')).toHaveLength(8);
    expect(rows.filter((row) => row.kind === 'task')).toHaveLength(6);
    expect(rows.filter((row) => row.kind === 'task-group-toggle')).toEqual([
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-project-tasks::project-a',
        hiddenCount: 2,
        expanded: true,
        rowVariant: 'underProject',
      },
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 1,
        expanded: true,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('applies a custom visible threshold to every pinned task group', () => {
    const rows = limitPinnedTaskListRows(entries, new Set(), 3);

    expect(rows.filter((row) => row.kind === 'project-task')).toHaveLength(4);
    expect(rows.filter((row) => row.kind === 'task')).toHaveLength(3);
    expect(rows.filter((row) => row.kind === 'task-group-toggle')).toEqual([
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-project-tasks::project-a',
        hiddenCount: 4,
        expanded: false,
        rowVariant: 'underProject',
      },
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 3,
        expanded: false,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('identifies the collapsed group hiding the selected task', () => {
    expect(findHiddenPinnedTaskGroupId(entries, new Set(), 'project-a', 'project-task-7')).toBe(
      'pinned-project-tasks::project-a'
    );
    expect(findHiddenPinnedTaskGroupId(entries, new Set(), 'project-c', 'pinned-task-6')).toBe(
      'pinned-tasks'
    );
    expect(
      findHiddenPinnedTaskGroupId(entries, new Set(), 'project-a', 'project-task-1')
    ).toBeNull();
    expect(findHiddenPinnedTaskGroupId(entries, new Set(), 'project-a', 'project-task-4', 3)).toBe(
      'pinned-project-tasks::project-a'
    );
    expect(
      findHiddenPinnedTaskGroupId(
        entries,
        new Set(['pinned-project-tasks::project-a']),
        'project-a',
        'project-task-7'
      )
    ).toBeNull();
  });
});
