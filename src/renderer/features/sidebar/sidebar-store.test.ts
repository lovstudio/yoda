import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import type { Task } from '@shared/tasks';
import type { SidebarTaskGroupVisibleLimit, SidebarTaskPriorityGroup } from '@shared/view-state';
import { DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import type { ProjectStore } from '@renderer/features/projects/stores/project';
import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { createUnprovisionedTask, type TaskStore } from '@renderer/features/tasks/stores/task';
import type { WorkspaceStore } from '@renderer/features/workspaces/workspace-store';
import { SidebarStore, type SidebarRow } from './sidebar-store';

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    viewState: {
      save: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
  sidebarStore: {},
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    readonly status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = vi.fn(async () => {});
    dispose = vi.fn();
  },
}));

describe('SidebarStore task recency ordering', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sorts no-group recent rows by parsed time when timestamp formats differ', () => {
    const newDbTask = makeTask('new-db-task', {
      createdAt: '2026-06-02 10:00:00',
      lastInteractedAt: '2026-06-02 10:00:00',
    });
    const olderIsoTask = makeTask('older-iso-task', {
      createdAt: '2026-06-02T09:59:59.000Z',
      lastInteractedAt: '2026-06-02T09:59:59.000Z',
    });
    const store = makeSidebarStore([makeProject('project-1', [olderIsoTask, newDbTask])]);

    store.applyGroupBy('none');
    store.applySort('updated-at');

    expect(taskIds(store.sidebarRows)).toEqual(['new-db-task', 'older-iso-task']);
  });

  it('re-sorts no-group recent rows when a task is touched', () => {
    const target = makeTask('target', {
      createdAt: '2026-06-02T08:00:00.000Z',
      lastInteractedAt: '2026-06-02T08:00:00.000Z',
    });
    const older = makeTask('older', {
      createdAt: '2026-06-02T09:00:00.000Z',
      lastInteractedAt: '2026-06-02T09:00:00.000Z',
    });
    const store = makeSidebarStore([makeProject('project-1', [target, older])]);

    store.applyGroupBy('none');
    store.applySort('updated-at');
    expect(taskIds(store.sidebarRows)).toEqual(['older', 'target']);

    runInAction(() => {
      target.data.lastInteractedAt = '2026-06-02T10:00:00.000Z';
    });

    expect(taskIds(store.sidebarRows)).toEqual(['target', 'older']);
  });

  it('moves pending-acceptance tasks out of both main and pinned sidebar lists', () => {
    const standard = makeTask('standard', {
      createdAt: '2026-06-02T10:00:00.000Z',
    });
    const pendingAcceptance = makeTask('pending-acceptance', {
      createdAt: '2026-06-02T11:00:00.000Z',
      needsReview: true,
      isPinned: true,
    });
    const store = makeSidebarStore([makeProject('project-1', [standard, pendingAcceptance])]);
    store.expandAllProjects();

    expect(taskIds(store.sidebarRows)).toEqual(['standard']);
    expect(store.pinnedSidebarEntries).toEqual([]);
  });

  it('groups tasks by live priority and keeps archived tasks behind a count-only group', () => {
    const awaiting = makeTask('awaiting', {
      createdAt: '2026-06-02T12:00:00.000Z',
    });
    const failed = makeTask('failed', {
      createdAt: '2026-06-02T11:00:00.000Z',
    });
    const completed = makeTask('completed', {
      createdAt: '2026-06-02T10:00:00.000Z',
      status: 'done',
    });
    const working = makeTask('working', {
      createdAt: '2026-06-02T09:00:00.000Z',
    });
    const review = makeTask('review', {
      createdAt: '2026-06-02T08:00:00.000Z',
      needsReview: true,
    });
    const longTerm = makeTask('long-term', {
      createdAt: '2026-06-02T07:00:00.000Z',
      isLongTerm: true,
    });
    const archived = makeTask('archived', {
      createdAt: '2026-06-02T06:00:00.000Z',
      archivedAt: '2026-06-03T06:00:00.000Z',
    });
    const runtimeStatuses = new Map([
      ['awaiting', 'awaiting-input' as const],
      ['failed', 'error' as const],
    ]);
    const store = makeSidebarStore(
      [
        makeProject('project-1', [
          awaiting,
          failed,
          completed,
          working,
          review,
          longTerm,
          archived,
        ]),
      ],
      {},
      {
        taskSessionStatuses: (_projectId: string, taskId: string) => {
          const status = runtimeStatuses.get(taskId);
          return status ? [{ conversationId: `${taskId}-conversation`, status }] : [];
        },
      }
    );
    store.expandAllProjects();
    store.setTaskPriorityMode(true);

    expect(priorityGroups(store.sidebarRows)).toEqual([
      'awaiting-input',
      'error',
      'completed',
      'working',
      'pending-review',
      'long-term',
      'archived',
    ]);
    expect(taskIds(store.sidebarRows)).toEqual([
      'awaiting',
      'failed',
      'completed',
      'working',
      'review',
      'long-term',
    ]);
  });

  it('replaces project grouping with global priority groups across collapsed projects', () => {
    const projectOneTask = makeTask('project-one-task', {
      createdAt: '2026-06-02T10:00:00.000Z',
      projectId: 'project-1',
    });
    const projectTwoTask = makeTask('project-two-task', {
      createdAt: '2026-06-02T11:00:00.000Z',
      projectId: 'project-2',
    });
    const archivedTask = makeTask('archived-task', {
      archivedAt: '2026-06-03T11:00:00.000Z',
      createdAt: '2026-06-02T09:00:00.000Z',
      projectId: 'project-2',
    });
    const store = makeSidebarStore([
      makeProject('project-1', [projectOneTask]),
      makeProject('project-2', [projectTwoTask, archivedTask]),
    ]);

    store.setTaskPriorityMode(true);

    expect(store.sidebarRows.some((row) => row.kind === 'project')).toBe(false);
    expect(priorityGroups(store.sidebarRows)).toEqual(['working', 'archived']);
    expect(
      store.sidebarRows.flatMap((row) =>
        row.kind === 'task'
          ? [{ projectId: row.projectId, taskId: row.taskId, showProjectTag: row.showProjectTag }]
          : []
      )
    ).toEqual([
      { projectId: 'project-2', taskId: 'project-two-task', showProjectTag: true },
      { projectId: 'project-1', taskId: 'project-one-task', showProjectTag: true },
    ]);
    expect(
      store.sidebarRows.find(
        (row) =>
          row.kind === 'group' && row.group.kind === 'priority' && row.group.priority === 'archived'
      )
    ).toEqual({ kind: 'group', group: { kind: 'priority', priority: 'archived', count: 1 } });

    store.setTaskPriorityMode(false);
    expect(store.sidebarRows.filter((row) => row.kind === 'project')).toHaveLength(2);
  });

  it('folds pinned projects and pinned tasks into priority groups until the mode is disabled', () => {
    const pinnedTask = makeTask('pinned-task', {
      createdAt: '2026-06-02T10:00:00.000Z',
      isPinned: true,
      projectId: 'project-1',
    });
    const pinnedProjectTask = makeTask('pinned-project-task', {
      createdAt: '2026-06-02T11:00:00.000Z',
      projectId: 'project-2',
    });
    const store = makeSidebarStore([
      makeProject('project-1', [pinnedTask]),
      makeProject('project-2', [pinnedProjectTask]),
    ]);
    store.pinnedProjectIds.add('project-2');

    expect(store.pinnedSidebarEntries).toEqual([
      { kind: 'project', projectId: 'project-2' },
      { kind: 'task', projectId: 'project-1', taskId: 'pinned-task' },
    ]);

    store.setTaskPriorityMode(true);

    expect(store.pinnedSidebarEntries).toEqual([]);
    expect(taskIds(store.sidebarRows)).toEqual(['pinned-project-task', 'pinned-task']);
    expect(
      store.sidebarRows
        .filter((row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task')
        .every((row) => row.showProjectTag)
    ).toBe(true);

    store.setTaskPriorityMode(false);
    expect(store.pinnedSidebarEntries).toEqual([
      { kind: 'project', projectId: 'project-2' },
      { kind: 'task', projectId: 'project-1', taskId: 'pinned-task' },
    ]);
  });

  it('lets the user reorder priority groups while keeping archived last', () => {
    const store = makeSidebarStore([]);

    store.moveTaskPriorityGroup('working', -1);

    expect(store.taskPriorityOrder).toEqual([
      'awaiting-input',
      'error',
      'working',
      'completed',
      'pending-review',
      'long-term',
      'archived',
    ]);
    store.moveTaskPriorityGroup('archived', -1);
    expect(store.taskPriorityOrder.at(-1)).toBe('archived');
  });

  it('keeps a project in place when its most-recent task is archived (updated-at)', () => {
    // project-late has the newest task, so it sorts above project-early.
    const lateTask = makeTask('late-task', {
      createdAt: '2026-06-02T10:00:00.000Z',
      lastInteractedAt: '2026-06-02T10:00:00.000Z',
      projectId: 'project-late',
    });
    const earlyTask = makeTask('early-task', {
      createdAt: '2026-06-02T08:00:00.000Z',
      lastInteractedAt: '2026-06-02T08:00:00.000Z',
      projectId: 'project-early',
    });
    const store = makeSidebarStore([
      makeProject('project-early', [earlyTask]),
      makeProject('project-late', [lateTask]),
    ]);

    store.applySort('updated-at');
    expect(projectIds(store.orderedProjects)).toEqual(['project-late', 'project-early']);

    // Archiving the late task must not demote project-late below project-early.
    runInAction(() => {
      (lateTask.data as { archivedAt?: string }).archivedAt = '2026-06-02T11:00:00.000Z';
    });

    expect(projectIds(store.orderedProjects)).toEqual(['project-late', 'project-early']);
  });

  it('moves a project to the front when one of its tasks is touched', () => {
    const target = makeTask('target', {
      createdAt: '2026-06-02T08:00:00.000Z',
      lastInteractedAt: '2026-06-02T08:00:00.000Z',
      projectId: 'project-early',
    });
    const leading = makeTask('leading', {
      createdAt: '2026-06-02T10:00:00.000Z',
      lastInteractedAt: '2026-06-02T10:00:00.000Z',
      projectId: 'project-late',
    });
    const store = makeSidebarStore([
      makeProject('project-early', [target]),
      makeProject('project-late', [leading]),
    ]);

    expect(projectIds(store.orderedProjects)).toEqual(['project-late', 'project-early']);

    runInAction(() => {
      target.data.lastInteractedAt = '2026-06-02T11:00:00.000Z';
    });

    expect(projectIds(store.orderedProjects)).toEqual(['project-early', 'project-late']);

    runInAction(() => {
      target.data.lastInteractedAt = '2026-06-02T07:00:00.000Z';
    });

    expect(store.projectActivityById['project-early']).toBe('2026-06-02T11:00:00.000Z');
    expect(projectIds(store.orderedProjects)).toEqual(['project-early', 'project-late']);
  });

  it('uses parsed time to find a project latest task across timestamp formats', () => {
    const newDbTask = makeTask('new-db-task', {
      createdAt: '2026-06-02 10:00:00',
      lastInteractedAt: '2026-06-02 10:00:00',
    });
    const olderIsoTask = makeTask('older-iso-task', {
      createdAt: '2026-06-02T09:59:59.000Z',
      lastInteractedAt: '2026-06-02T09:59:59.000Z',
    });
    const store = makeSidebarStore([makeProject('project-1', [olderIsoTask, newDbTask])]);

    expect(store.projectActivityById['project-1']).toBe('2026-06-02 10:00:00');
  });

  it('groups activity rows by last interaction even when created-at sort is selected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T12:00:00.000Z'));

    const recentReply = makeTask('recent-reply', {
      createdAt: '2026-05-01 10:00:00',
      lastInteractedAt: '2026-06-02T11:00:00.000Z',
    });
    const newButOlderReply = makeTask('new-but-older-reply', {
      createdAt: '2026-06-02 10:00:00',
      lastInteractedAt: '2026-05-15T10:00:00.000Z',
    });
    const store = makeSidebarStore([makeProject('project-1', [newButOlderReply, recentReply])]);

    store.applySort('created-at');
    store.applyGroupBy('activity');

    expect(store.sidebarRows[0]).toEqual({
      kind: 'group',
      group: { kind: 'activity', bucket: 'today' },
    });
    expect(taskIds(store.sidebarRows)).toEqual(['recent-reply', 'new-but-older-reply']);
  });

  it('persists the global sidebar nav section visibility in snapshots', () => {
    const store = makeSidebarStore([makeProject('project-1', [])]);

    store.setNavSectionHidden(true);

    expect(store.snapshot.navSectionHidden).toBe(true);

    const restored = makeSidebarStore([makeProject('project-1', [])]);
    restored.restoreSnapshot({ navSectionHidden: store.snapshot.navSectionHidden });

    expect(restored.navSectionHidden).toBe(true);

    restored.setNavSectionHidden(false);

    expect(restored.navSectionHidden).toBe(false);
  });

  it('defaults, persists, and validates the task-group collapse threshold', () => {
    const store = makeSidebarStore([makeProject('project-1', [])]);
    expect(store.taskGroupVisibleLimit).toBe(5);

    store.setTaskGroupVisibleLimit(10);
    expect(store.snapshot.taskGroupVisibleLimit).toBe(10);

    const restored = makeSidebarStore([makeProject('project-1', [])]);
    restored.restoreSnapshot({ taskGroupVisibleLimit: store.snapshot.taskGroupVisibleLimit });
    expect(restored.taskGroupVisibleLimit).toBe(10);

    restored.restoreSnapshot({
      taskGroupVisibleLimit: 7 as SidebarTaskGroupVisibleLimit,
    });
    expect(restored.taskGroupVisibleLimit).toBe(10);
  });

  it('keeps a project visible while its sessions load when empty projects are hidden', () => {
    const project = makeProject('loading-project', [], 'loading');
    const store = makeSidebarStore([project]);
    store.setHideProjectsWithoutActiveTasks(true);

    expect(projectIds(store.orderedProjects)).toEqual(['loading-project']);

    const taskManager = project.mountedProject?.taskManager;
    expect(taskManager).toBeDefined();
    if (!taskManager) return;
    runInAction(() => {
      taskManager.taskLoadState = 'loaded';
    });

    expect(store.orderedProjects).toEqual([]);
  });

  it('keeps an expanded project connected to tasks loaded after the project row', () => {
    const project = makeProject('project-1', [], 'loading');
    const store = makeSidebarStore([project]);

    store.toggleProjectExpanded('project-1');
    expect(taskIds(store.sidebarRows)).toEqual([]);

    runInAction(() => {
      project.mountedProject?.taskManager.tasks.set(
        'loaded-task',
        makeTask('loaded-task', { createdAt: '2026-06-02T10:00:00.000Z' })
      );
    });

    expect(store.expandedProjectIds.has('project-1')).toBe(true);
    expect(taskIds(store.sidebarRows)).toEqual(['loaded-task']);
  });
});

describe('SidebarStore subtask tree rows', () => {
  it('nests children under their parent with increasing depth (DFS order)', () => {
    const parent = makeTask('parent', { createdAt: '2026-06-02T10:00:00.000Z' });
    const child = makeTask('child', {
      createdAt: '2026-06-02T11:00:00.000Z',
      parentTaskId: 'parent',
    });
    const grandchild = makeTask('grandchild', {
      createdAt: '2026-06-02T12:00:00.000Z',
      parentTaskId: 'child',
    });
    const sibling = makeTask('sibling', { createdAt: '2026-06-02T09:00:00.000Z' });
    const store = makeSidebarStore([
      makeProject('project-1', [sibling, grandchild, child, parent]),
    ]);
    store.expandAllProjects();

    const rows = store.sidebarRows.filter(
      (row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task'
    );
    expect(rows.map((row) => [row.taskId, row.depth])).toEqual([
      ['parent', 0],
      ['child', 1],
      ['grandchild', 2],
      ['sibling', 0],
    ]);
    expect(rows[0].childCount).toBe(1);
  });

  it('collapsing a task hides its whole subtree', () => {
    const parent = makeTask('parent', { createdAt: '2026-06-02T10:00:00.000Z' });
    const child = makeTask('child', {
      createdAt: '2026-06-02T11:00:00.000Z',
      parentTaskId: 'parent',
    });
    const grandchild = makeTask('grandchild', {
      createdAt: '2026-06-02T12:00:00.000Z',
      parentTaskId: 'child',
    });
    const store = makeSidebarStore([makeProject('project-1', [parent, child, grandchild])]);
    store.expandAllProjects();

    store.toggleTaskCollapsed('parent');
    expect(taskIds(store.sidebarRows)).toEqual(['parent']);

    store.toggleTaskCollapsed('parent');
    expect(taskIds(store.sidebarRows)).toEqual(['parent', 'child', 'grandchild']);
  });

  it('promotes tasks to root at display time when the parent is not visible', () => {
    const archivedParent = makeTask('archived-parent', {
      createdAt: '2026-06-02T10:00:00.000Z',
      archivedAt: '2026-06-02T12:00:00.000Z',
    });
    const orphan = makeTask('orphan', {
      createdAt: '2026-06-02T11:00:00.000Z',
      parentTaskId: 'archived-parent',
    });
    const pinnedParent = makeTask('pinned-parent', {
      createdAt: '2026-06-02T09:00:00.000Z',
      isPinned: true,
    });
    const pinnedChild = makeTask('pinned-child', {
      createdAt: '2026-06-02T08:00:00.000Z',
      parentTaskId: 'pinned-parent',
    });
    const store = makeSidebarStore([
      makeProject('project-1', [archivedParent, orphan, pinnedParent, pinnedChild]),
    ]);
    store.expandAllProjects();

    const rows = store.sidebarRows.filter(
      (row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task'
    );
    expect(rows.map((row) => [row.taskId, row.depth])).toEqual([
      ['orphan', 0],
      ['pinned-child', 0],
    ]);
  });

  it('surfaces dirty-data cycles at root instead of losing the tasks', () => {
    const a = makeTask('a', { createdAt: '2026-06-02T10:00:00.000Z', parentTaskId: 'b' });
    const b = makeTask('b', { createdAt: '2026-06-02T11:00:00.000Z', parentTaskId: 'a' });
    const store = makeSidebarStore([makeProject('project-1', [a, b])]);
    store.expandAllProjects();

    expect(taskIds(store.sidebarRows).sort()).toEqual(['a', 'b']);
  });

  it('persists per-parent order and collapsed ids in snapshots', () => {
    const store = makeSidebarStore([makeProject('project-1', [])]);
    store.setChildTaskOrder('parent', ['c2', 'c1']);
    store.toggleTaskCollapsed('parent');

    const snapshot = store.snapshot;
    expect(snapshot.taskOrderByParent).toEqual({ parent: ['c2', 'c1'] });
    expect(snapshot.collapsedTaskIds).toEqual(['parent']);

    const restored = makeSidebarStore([makeProject('project-1', [])]);
    restored.restoreSnapshot({
      taskOrderByParent: snapshot.taskOrderByParent,
      collapsedTaskIds: snapshot.collapsedTaskIds,
    });
    expect(restored.taskOrderByParent).toEqual({ parent: ['c2', 'c1'] });
    expect(restored.collapsedTaskIds.has('parent')).toBe(true);
  });

  it('orders siblings by the per-parent manual order', () => {
    const parent = makeTask('parent', { createdAt: '2026-06-02T10:00:00.000Z' });
    const c1 = makeTask('c1', { createdAt: '2026-06-02T11:00:00.000Z', parentTaskId: 'parent' });
    const c2 = makeTask('c2', { createdAt: '2026-06-02T12:00:00.000Z', parentTaskId: 'parent' });
    const store = makeSidebarStore([makeProject('project-1', [parent, c1, c2])]);
    store.expandAllProjects();

    // Date sort (desc) puts c2 first by default.
    expect(taskIds(store.sidebarRows)).toEqual(['parent', 'c2', 'c1']);

    store.setChildTaskOrder('parent', ['c1', 'c2']);
    expect(taskIds(store.sidebarRows)).toEqual(['parent', 'c1', 'c2']);
  });

  it('reveals the selected task and expands its collapsed ancestors', () => {
    const parent = makeTask('parent', { createdAt: '2026-06-02T10:00:00.000Z' });
    const child = makeTask('child', {
      createdAt: '2026-06-02T11:00:00.000Z',
      parentTaskId: 'parent',
    });
    const store = makeSidebarStore([makeProject('project-1', [parent, child])]);
    store.projectsCollapsed = true;
    store.collapsedTaskIds.add('parent');

    store.revealSelection('project-1', 'child');

    expect(store.projectsCollapsed).toBe(false);
    expect(store.expandedProjectIds.has('project-1')).toBe(true);
    expect(store.collapsedTaskIds.has('parent')).toBe(false);
  });

  it('issues a fresh one-shot reveal request for repeated project locator clicks', () => {
    const store = makeSidebarStore([makeProject('project-1', [])]);
    store.projectsCollapsed = true;

    store.requestSelectionReveal('project-1');
    const firstRequestId = store.selectionRevealRequest?.requestId;

    expect(firstRequestId).toBe(1);
    expect(store.projectsCollapsed).toBe(false);
    expect(store.expandedProjectIds.has('project-1')).toBe(true);

    store.requestSelectionReveal('project-1');
    expect(store.selectionRevealRequest?.requestId).toBe(2);

    store.completeSelectionReveal(1);
    expect(store.selectionRevealRequest?.requestId).toBe(2);

    store.completeSelectionReveal(2);
    expect(store.selectionRevealRequest).toBeNull();
  });

  it('makes a filtered project visible before issuing its locator request', () => {
    const store = makeSidebarStore([makeProject('project-1', [])]);
    store.applyGroupBy('activity');
    store.setProjectTypeFilter('ssh');
    store.setHideProjectsWithoutActiveTasks(true);

    expect(store.sidebarRows).not.toContainEqual({
      kind: 'project',
      projectId: 'project-1',
    });

    store.requestSelectionReveal('project-1');

    expect(store.taskGroupBy).toBe('project');
    expect(store.projectTypeFilter).toBe('all');
    expect(store.hideProjectsWithoutActiveTasks).toBe(false);
    expect(store.sidebarRows).toContainEqual({
      kind: 'project',
      projectId: 'project-1',
    });
  });

  it('preserves filters that already list the located project', () => {
    const task = makeTask('task-1', {
      createdAt: '2026-06-02T10:00:00.000Z',
    });
    const store = makeSidebarStore([makeProject('project-1', [task])]);
    store.applyGroupBy('type');
    store.setProjectTypeFilter('local');
    store.setHideProjectsWithoutActiveTasks(true);

    store.requestSelectionReveal('project-1');

    expect(store.taskGroupBy).toBe('type');
    expect(store.projectTypeFilter).toBe('local');
    expect(store.hideProjectsWithoutActiveTasks).toBe(true);
    expect(store.sidebarRows).toContainEqual({
      kind: 'project',
      projectId: 'project-1',
    });
  });

  it('opens the pinned section when the selected task is pinned', () => {
    const pinned = makeTask('pinned', {
      createdAt: '2026-06-02T10:00:00.000Z',
      isPinned: true,
    });
    const store = makeSidebarStore([makeProject('project-1', [pinned])]);
    store.pinnedCollapsed = true;
    store.projectsCollapsed = true;

    store.revealSelection('project-1', 'pinned');

    expect(store.pinnedCollapsed).toBe(false);
    expect(store.projectsCollapsed).toBe(true);
    expect(store.expandedProjectIds.has('project-1')).toBe(true);
  });

  it('follows a selected project into its workspace when filtering', () => {
    const setActiveWorkspaceId = vi.fn();
    const store = makeSidebarStore([makeProject('project-1', [])], {
      activeWorkspaceId: 'workspace-1',
      isFiltering: true,
      matchesActive: () => false,
      setActiveWorkspaceId,
    });

    store.revealSelection('project-1');

    expect(setActiveWorkspaceId).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID);
  });
});

function makeTask(
  id: string,
  timestamps: {
    createdAt: string;
    lastInteractedAt?: string;
    projectId?: string;
    parentTaskId?: string;
    isPinned?: boolean;
    archivedAt?: string;
    needsReview?: boolean;
    isLongTerm?: boolean;
    status?: Task['status'];
  }
): TaskStore {
  const task: Task = {
    id,
    projectId: timestamps.projectId ?? 'project-1',
    name: id,
    status: timestamps.status ?? 'in_progress',
    sourceBranch: undefined,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.createdAt,
    statusChangedAt: timestamps.createdAt,
    lastInteractedAt: timestamps.lastInteractedAt,
    parentTaskId: timestamps.parentTaskId,
    archivedAt: timestamps.archivedAt,
    isPinned: timestamps.isPinned ?? false,
    isFavorite: false,
    isLongTerm: timestamps.isLongTerm ?? false,
    needsReview: timestamps.needsReview ?? false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
  return createUnprovisionedTask(task);
}

function makeProject(
  projectId: string,
  tasks: TaskStore[],
  taskLoadState: 'idle' | 'loading' | 'loaded' | 'error' = 'loaded'
): ProjectStore {
  const data: LocalProject = {
    type: 'local',
    id: projectId,
    name: projectId,
    alias: null,
    path: `/tmp/${projectId}`,
    baseRef: 'main',
    workspaceId: null,
    isInternal: false,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  };
  return {
    state: 'mounted',
    id: projectId,
    name: projectId,
    alias: null,
    data,
    phase: null,
    error: undefined,
    errorCode: undefined,
    mode: null,
    mountedProject: {
      taskManager: observable({
        tasks: observable.map(tasks.map((task) => [task.data.id, task])),
        taskLoadState,
        taskCounts: {
          active: tasks.filter((task) => !('archivedAt' in task.data) || !task.data.archivedAt)
            .length,
          archived: tasks.filter((task) => 'archivedAt' in task.data && task.data.archivedAt)
            .length,
        },
      }),
    },
  } as ProjectStore;
}

function makeSidebarStore(
  projects: ProjectStore[],
  workspaceOverrides: Partial<WorkspaceStore> = {},
  agentRuntime?: {
    taskSessionStatuses: (
      projectId: string,
      taskId: string
    ) => { conversationId: string; status: 'working' | 'awaiting-input' | 'error' | 'completed' }[];
  }
): SidebarStore {
  return new SidebarStore(
    {
      projects: observable.map(projects.map((project) => [project.id, project])),
    } as ProjectManagerStore,
    {
      activeWorkspaceId: 'all',
      isFiltering: false,
      matchesActive: () => true,
      ...workspaceOverrides,
    } as unknown as WorkspaceStore,
    agentRuntime
  );
}

function taskIds(rows: SidebarRow[]): string[] {
  return rows
    .filter((row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task')
    .map((row) => row.taskId);
}

function priorityGroups(rows: SidebarRow[]): SidebarTaskPriorityGroup[] {
  return rows.flatMap((row) =>
    row.kind === 'group' && row.group.kind === 'priority' ? [row.group.priority] : []
  );
}

function projectIds(projects: ProjectStore[]): string[] {
  return projects.map((project) => project.id);
}
