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
    const rows = limitPinnedTaskListRows(entries, new Map());

    expect(rows).toEqual([
      { kind: 'project', projectId: 'project-a' },
      ...entries.slice(1, 6),
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-project-tasks::project-a',
        hiddenCount: 2,
        rowVariant: 'underProject',
      },
      { kind: 'project', projectId: 'project-b' },
      projectTask('project-b', 'project-b-task'),
      ...entries.slice(10, 15),
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 1,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('increments pinned groups independently', () => {
    const rows = limitPinnedTaskListRows(
      entries,
      new Map([['pinned-project-tasks::project-a', 15]])
    );

    expect(rows.filter((row) => row.kind === 'project-task')).toHaveLength(8);
    expect(rows.filter((row) => row.kind === 'task')).toHaveLength(5);
    expect(rows.filter((row) => row.kind === 'task-group-toggle')).toEqual([
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 1,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('applies a custom visible threshold to every pinned task group', () => {
    const rows = limitPinnedTaskListRows(entries, new Map(), 3);

    expect(rows.filter((row) => row.kind === 'project-task')).toHaveLength(4);
    expect(rows.filter((row) => row.kind === 'task')).toHaveLength(3);
    expect(rows.filter((row) => row.kind === 'task-group-toggle')).toEqual([
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-project-tasks::project-a',
        hiddenCount: 4,
        rowVariant: 'underProject',
      },
      {
        kind: 'task-group-toggle',
        groupId: 'pinned-tasks',
        hiddenCount: 3,
        rowVariant: 'pinned',
      },
    ]);
  });

  it('identifies the collapsed group hiding the selected task', () => {
    expect(findHiddenPinnedTaskGroupId(entries, new Map(), 'project-a', 'project-task-7')).toEqual({
      groupId: 'pinned-project-tasks::project-a',
      visibleCount: 7,
    });
    expect(findHiddenPinnedTaskGroupId(entries, new Map(), 'project-c', 'pinned-task-6')).toEqual({
      groupId: 'pinned-tasks',
      visibleCount: 6,
    });
    expect(
      findHiddenPinnedTaskGroupId(entries, new Map(), 'project-a', 'project-task-1')
    ).toBeNull();
    expect(
      findHiddenPinnedTaskGroupId(
        entries,
        new Map([['pinned-project-tasks::project-a', 7]]),
        'project-a',
        'project-task-7'
      )
    ).toBeNull();
  });
});
