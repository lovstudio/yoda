import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import type { Task } from '@shared/tasks';
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
  }
): TaskStore {
  const task: Task = {
    id,
    projectId: timestamps.projectId ?? 'project-1',
    name: id,
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.createdAt,
    statusChangedAt: timestamps.createdAt,
    lastInteractedAt: timestamps.lastInteractedAt,
    parentTaskId: timestamps.parentTaskId,
    archivedAt: timestamps.archivedAt,
    isPinned: timestamps.isPinned ?? false,
    needsReview: false,
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
      }),
    },
  } as ProjectStore;
}

function makeSidebarStore(projects: ProjectStore[]): SidebarStore {
  return new SidebarStore(
    {
      projects: observable.map(projects.map((project) => [project.id, project])),
    } as ProjectManagerStore,
    {
      activeWorkspaceId: 'all',
      isFiltering: false,
      matchesActive: () => true,
    } as unknown as WorkspaceStore
  );
}

function taskIds(rows: SidebarRow[]): string[] {
  return rows
    .filter((row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task')
    .map((row) => row.taskId);
}

function projectIds(projects: ProjectStore[]): string[] {
  return projects.map((project) => project.id);
}
