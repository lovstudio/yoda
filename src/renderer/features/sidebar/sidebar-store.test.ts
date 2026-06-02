import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import type { Task } from '@shared/tasks';
import type { ProjectStore } from '@renderer/features/projects/stores/project';
import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { createUnprovisionedTask, type TaskStore } from '@renderer/features/tasks/stores/task';
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
});

function makeTask(
  id: string,
  timestamps: { createdAt: string; lastInteractedAt?: string }
): TaskStore {
  const task: Task = {
    id,
    projectId: 'project-1',
    name: id,
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.createdAt,
    statusChangedAt: timestamps.createdAt,
    lastInteractedAt: timestamps.lastInteractedAt,
    isPinned: false,
    needsReview: false,
    isUserNamed: false,
    prs: [],
    conversations: {},
  };
  return createUnprovisionedTask(task);
}

function makeProject(projectId: string, tasks: TaskStore[]): ProjectStore {
  const data: LocalProject = {
    type: 'local',
    id: projectId,
    name: projectId,
    alias: null,
    path: `/tmp/${projectId}`,
    baseRef: 'main',
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
      taskManager: {
        tasks: observable.map(tasks.map((task) => [task.data.id, task])),
      },
    },
  } as ProjectStore;
}

function makeSidebarStore(projects: ProjectStore[]): SidebarStore {
  return new SidebarStore({
    projects: observable.map(projects.map((project) => [project.id, project])),
  } as ProjectManagerStore);
}

function taskIds(rows: SidebarRow[]): string[] {
  return rows
    .filter((row): row is Extract<SidebarRow, { kind: 'task' }> => row.kind === 'task')
    .map((row) => row.taskId);
}
