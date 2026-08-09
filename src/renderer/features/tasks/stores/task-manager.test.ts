import { observable } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { prSyncProgressChannel, prUpdatedChannel } from '@shared/events/prEvents';
import {
  taskArchivedChannel,
  taskCreatedChannel,
  taskDeletedChannel,
  taskMovedChannel,
  taskRenamedChannel,
  taskRestoredChannel,
  taskStatusUpdatedChannel,
} from '@shared/events/taskEvents';
import type { PullRequest } from '@shared/pull-requests';
import type { CreateTaskParams, Task } from '@shared/tasks';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  registeredTaskData,
  type TaskStore,
} from './task';
import { TaskManagerStore } from './task-manager';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getConversationsForTask: vi.fn(),
  getPullRequestsForProjectTasks: vi.fn().mockResolvedValue({
    success: true,
    data: { taskPullRequests: [] },
  }),
  getActiveTasks: vi.fn(),
  getArchivedTasks: vi.fn(),
  getTask: vi.fn(),
  getTasksByIds: vi.fn(),
  getTaskCounts: vi.fn().mockResolvedValue([{ projectId: 'project-1', active: 0, archived: 0 }]),
  invalidatePageData: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
  unsubscribers: [] as Array<ReturnType<typeof vi.fn>>,
  mountProject: vi.fn(),
  provisionTask: vi.fn(),
  restoreTask: vi.fn().mockResolvedValue({ restoredTaskIds: ['task-1'] }),
  viewStateSet: vi.fn(),
  viewStateGet: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, cb: (data: unknown) => void) => {
      mocks.listeners.set(event.name, cb);
      const unsubscribe = vi.fn(() => {
        if (mocks.listeners.get(event.name) === cb) mocks.listeners.delete(event.name);
      });
      mocks.unsubscribers.push(unsubscribe);
      return unsubscribe;
    }),
  },
  rpc: {
    conversations: {
      getConversationsForTask: mocks.getConversationsForTask,
    },
    pullRequests: {
      getPullRequestsForProjectTasks: mocks.getPullRequestsForProjectTasks,
    },
    tasks: {
      createTask: mocks.createTask,
      getActiveTasks: mocks.getActiveTasks,
      getArchivedTasks: mocks.getArchivedTasks,
      getTask: mocks.getTask,
      getTasksByIds: mocks.getTasksByIds,
      getTaskCounts: mocks.getTaskCounts,
      provisionTask: mocks.provisionTask,
      restoreTask: mocks.restoreTask,
    },
  },
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    mountProject: mocks.mountProject,
    projects: new Map(),
  }),
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    readonly status = 'disconnected';

    constructor(readonly sessionId: string) {}

    connect = vi.fn(async () => {});
    dispose = vi.fn();
  },
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: mocks.viewStateGet,
    set: mocks.viewStateSet,
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    agentRuntime: {
      forgetTask: vi.fn(),
    },
    history: {
      push: vi.fn(),
    },
  },
  sidebarStore: {},
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

beforeEach(() => {
  mocks.getActiveTasks.mockReset().mockResolvedValue([]);
  mocks.getArchivedTasks.mockReset().mockResolvedValue([]);
  mocks.getTask.mockReset().mockResolvedValue(null);
  mocks.getTasksByIds.mockReset().mockResolvedValue([]);
  mocks.getTaskCounts
    .mockReset()
    .mockResolvedValue([{ projectId: 'project-1', active: 0, archived: 0 }]);
  mocks.getPullRequestsForProjectTasks.mockReset().mockResolvedValue({
    success: true,
    data: { taskPullRequests: [] },
  });
  mocks.restoreTask.mockReset().mockResolvedValue({ restoredTaskIds: ['task-1'] });
});

describe('TaskManagerStore task rename events', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('applies task rename events while a task is still creating', () => {
    const manager = createManager();
    manager.tasks.set(
      'task-1',
      createUnregisteredTask({
        id: 'task-1',
        name: 'Initial title',
        status: 'in_progress',
        lastInteractedAt: '2026-06-05T10:00:00.000Z',
        createdAt: '2026-06-05T10:00:00.000Z',
        statusChangedAt: '2026-06-05T10:00:00.000Z',
        isPinned: false,
        isFavorite: false,
        isLongTerm: false,
        needsReview: false,
      })
    );

    emitTaskRenamed('User title');

    expect(manager.tasks.get('task-1')?.data.name).toBe('User title');
    expect(manager.tasks.get('task-1')?.data.isUserNamed).toBe(true);
    manager.dispose();
  });

  it('preserves a task rename event that arrives before createTask returns', async () => {
    const manager = createManager();
    vi.spyOn(manager, 'provisionTask').mockResolvedValue(undefined);
    mocks.createTask.mockImplementation(async () => {
      emitTaskRenamed('User title');
      return {
        success: true,
        data: {
          task: makeTask('Initial title'),
        },
      };
    });

    await manager.createTask(makeCreateTaskParams('Initial title'));

    const task = manager.tasks.get('task-1');
    expect(task?.state).toBe('unprovisioned');
    expect(task?.data.name).toBe('User title');
    expect(task?.data.isUserNamed).toBe(true);
    manager.dispose();
  });
});

describe('TaskManagerStore task status events', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('applies status updates to registered tasks that are not provisioned', () => {
    const manager = createManager();
    const task = createUnprovisionedTask(makeTask('Background task'));
    manager.tasks.set('task-1', task);

    emitTaskStatusUpdated('review');

    expect(task.data.status).toBe('review');
    manager.dispose();
  });
});

describe('TaskManagerStore archive events', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('disposes a provisioned renderer task as soon as main archives it', () => {
    const manager = createManager();
    const transitionToUnprovisioned = vi.fn();
    const dispose = vi.fn();
    const task = makeTask('Task');
    task.prs = [makePullRequest('https://github.com/lovstudio/yoda', 'feature/task')];
    manager.tasks.set('task-1', {
      state: 'provisioned',
      data: task,
      transitionToUnprovisioned,
      dispose,
    } as unknown as TaskStore);

    const listener = mocks.listeners.get(taskArchivedChannel.name);
    expect(listener).toBeDefined();
    listener?.({ taskId: 'task-1', projectId: 'project-1' });

    expect(transitionToUnprovisioned).toHaveBeenCalledOnce();
    expect(transitionToUnprovisioned).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', archivedAt: expect.any(String), prs: [] }),
      'idle'
    );
    expect(manager.tasks.has('task-1')).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('does not revive an archived task when an earlier provision RPC resolves late', async () => {
    const manager = createManager();
    manager.taskLoadState = 'loaded';
    const store = createUnprovisionedTask(makeTask('Task'));
    manager.tasks.set('task-1', store);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.getActiveTasks.mockResolvedValue([]);
    mocks.getConversationsForTask.mockResolvedValue([]);
    mocks.viewStateGet.mockResolvedValue(undefined);
    let finishProvision!: (result: {
      path: string;
      workspaceId: string;
      sshConnectionId?: string;
    }) => void;
    mocks.provisionTask.mockReturnValue(
      new Promise((resolve) => {
        finishProvision = resolve;
      })
    );

    const provision = manager.provisionTask('task-1');
    await vi.waitFor(() => expect(mocks.provisionTask).toHaveBeenCalledWith('task-1'));
    const listener = mocks.listeners.get(taskArchivedChannel.name);
    listener?.({ taskId: 'task-1', projectId: 'project-1' });
    finishProvision({ path: '/repo/task-1', workspaceId: 'workspace-1' });
    await provision;

    expect(store.state).toBe('unprovisioned');
    expect(store.phase).toBe('idle');
    expect(manager.tasks.has('task-1')).toBe(false);
    expect(store.provisionedTask).toBeNull();
    manager.dispose();
  });
});

describe('TaskManagerStore restore and delete events', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('reconciles a cross-window restore with one active project snapshot', async () => {
    const manager = createManager();
    manager.taskLoadState = 'loaded';
    const restored = makeTask('Restored task', undefined, 'task-restored');
    mocks.getTasksByIds.mockResolvedValue([restored]);

    mocks.listeners.get(taskRestoredChannel.name)?.({
      projectId: 'project-1',
      restoredTaskIds: ['task-restored'],
    });

    await vi.waitFor(() => expect(manager.tasks.has('task-restored')).toBe(true));
    expect(mocks.getTasksByIds).toHaveBeenCalledWith('project-1', ['task-restored']);
    manager.dispose();
  });

  it('drops a deleted task and reparents its resident children', () => {
    const manager = createManager();
    const parent = createUnprovisionedTask(makeTask('Parent'));
    const child = createUnprovisionedTask(makeTask('Child', 'task-1', 'task-2'));
    manager.tasks.set('task-1', parent);
    manager.tasks.set('task-2', child);

    mocks.listeners.get(taskDeletedChannel.name)?.({
      projectId: 'project-1',
      taskId: 'task-1',
      parentTaskId: 'grandparent',
    });

    expect(manager.tasks.has('task-1')).toBe(false);
    expect(registeredTaskData(child)?.parentTaskId).toBe('grandparent');
    manager.dispose();
  });

  it('drops and disposes a task moved out by another renderer', () => {
    const manager = createManager();
    const moved = createUnprovisionedTask(makeTask('Moved task'));
    const dispose = vi.spyOn(moved, 'dispose');
    manager.tasks.set('task-1', moved);

    mocks.listeners.get(taskMovedChannel.name)?.({
      taskId: 'task-1',
      sourceProjectId: 'project-1',
      targetProjectId: 'project-2',
    });

    expect(manager.tasks.has('task-1')).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('point-loads a task moved into the project by another renderer', async () => {
    const manager = createManager();
    mocks.getTask.mockResolvedValue(makeTask('Moved task'));

    mocks.listeners.get(taskMovedChannel.name)?.({
      taskId: 'task-1',
      sourceProjectId: 'project-2',
      targetProjectId: 'project-1',
    });

    await vi.waitFor(() => expect(manager.tasks.has('task-1')).toBe(true));
    expect(mocks.getTask).toHaveBeenCalledWith('project-1', 'task-1');
    manager.dispose();
  });
});

describe('TaskManagerStore external task reconciliation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('loads a task added after the initial project snapshot', async () => {
    const manager = createManager();
    mocks.getActiveTasks.mockResolvedValue([]);
    mocks.getTask.mockResolvedValue(makeTask('Imported session'));
    mocks.getPullRequestsForProjectTasks.mockResolvedValue({ success: false });

    const loaded = await manager.ensureTaskLoaded('task-1');

    expect(loaded).toBe(true);
    expect(mocks.getActiveTasks).toHaveBeenCalledWith('project-1');
    expect(mocks.getTask).toHaveBeenCalledWith('project-1', 'task-1');
    expect(manager.tasks.get('task-1')?.data.name).toBe('Imported session');
    manager.dispose();
  });

  it('coalesces concurrent point loads without re-reading the project snapshot', async () => {
    const manager = createManager();
    mocks.getActiveTasks.mockResolvedValue([]);
    let finishPointLoad!: (task: Task | null) => void;
    mocks.getTask.mockReturnValue(
      new Promise<Task | null>((resolve) => {
        finishPointLoad = resolve;
      })
    );

    const first = manager.ensureTaskLoaded('task-1');
    const second = manager.ensureTaskLoaded('task-1');
    await vi.waitFor(() => expect(mocks.getTask).toHaveBeenCalledOnce());
    finishPointLoad(makeTask('Imported session'));

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(mocks.getActiveTasks).toHaveBeenCalledOnce();
    expect(mocks.getTask).toHaveBeenCalledWith('project-1', 'task-1');
    manager.dispose();
  });

  it('reports task loading while imported sessions are being read', async () => {
    const manager = createManager();
    let resolveTasks: ((tasks: Task[]) => void) | undefined;
    mocks.getActiveTasks.mockReturnValue(
      new Promise<Task[]>((resolve) => {
        resolveTasks = resolve;
      })
    );
    mocks.getPullRequestsForProjectTasks.mockResolvedValue({ success: false });

    const loading = manager.loadTasks();

    expect(manager.taskLoadState).toBe('loading');
    resolveTasks?.([makeTask('Imported session')]);
    await loading;

    expect(manager.taskLoadState).toBe('loaded');
    expect(manager.tasks.get('task-1')?.data.name).toBe('Imported session');
    manager.dispose();
  });

  it('loads a task when main reports that mobile creation completed', async () => {
    const manager = createManager();
    mocks.getActiveTasks.mockResolvedValue([]);
    mocks.getTask.mockResolvedValue(makeTask('Created on mobile'));
    mocks.getPullRequestsForProjectTasks.mockResolvedValue({ success: false });

    emitTaskCreated();

    await vi.waitFor(() => {
      expect(manager.tasks.get('task-1')?.data.name).toBe('Created on mobile');
    });
    expect(mocks.getTask).toHaveBeenCalledWith('project-1', 'task-1');
    manager.dispose();
  });

  it('keeps the local optimistic task when its own creation event arrives', async () => {
    const manager = createManager();
    const optimisticTask = createUnregisteredTask({
      id: 'task-1',
      name: 'Creating locally',
      status: 'in_progress',
      lastInteractedAt: '2026-06-05T10:00:00.000Z',
      createdAt: '2026-06-05T10:00:00.000Z',
      statusChangedAt: '2026-06-05T10:00:00.000Z',
      isPinned: false,
      isFavorite: false,
      isLongTerm: false,
      needsReview: false,
    });
    manager.tasks.set('task-1', optimisticTask);

    emitTaskCreated();
    await Promise.resolve();

    expect(manager.tasks.get('task-1')).toBe(optimisticTask);
    expect(mocks.getActiveTasks).not.toHaveBeenCalled();
    expect(mocks.getTask).not.toHaveBeenCalled();
    manager.dispose();
  });
});

describe('TaskManagerStore pull request snapshots', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('loads cached PRs for 916 tasks with one project-level RPC', async () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    const tasks = Array.from({ length: 916 }, (_, index) => {
      const task = makeTask(`Task ${index}`, undefined, `task-${index}`);
      task.taskBranch = `task-${index}`;
      if (index >= 33) task.archivedAt = '2026-06-06T10:00:00.000Z';
      return task;
    });
    mocks.getActiveTasks.mockResolvedValue(tasks.filter((task) => !task.archivedAt));
    mocks.getTaskCounts.mockResolvedValue([{ projectId: 'project-1', active: 33, archived: 883 }]);
    mocks.getPullRequestsForProjectTasks.mockResolvedValue({
      success: true,
      data: { taskPullRequests: [] },
    });

    await manager.loadTasks();
    await vi.waitFor(() => {
      expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledTimes(1);
    });

    expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledWith('project-1', repositoryUrl);
    expect(mocks.getActiveTasks).toHaveBeenCalledOnce();
    expect(mocks.getArchivedTasks).not.toHaveBeenCalled();
    expect(manager.tasks.size).toBe(33);
    expect(manager.taskCounts).toEqual({ active: 33, archived: 883 });
    manager.dispose();
  });

  it('hydrates archived tasks only while the Archived tab requests them', async () => {
    const manager = createManager();
    const activeTasks = Array.from({ length: 33 }, (_, index) =>
      makeTask(`Active ${index}`, undefined, `active-${index}`)
    );
    const archivedTasks = Array.from({ length: 883 }, (_, index) => {
      const task = makeTask(`Archived ${index}`, undefined, `archived-${index}`);
      task.archivedAt = '2026-06-06T10:00:00.000Z';
      return task;
    });
    mocks.getActiveTasks.mockResolvedValue(activeTasks);
    let finishArchived!: (tasks: Task[]) => void;
    mocks.getArchivedTasks.mockReturnValue(
      new Promise<Task[]>((resolve) => {
        finishArchived = resolve;
      })
    );

    await manager.loadTasks();
    const first = manager.loadArchivedTasks();
    const second = manager.loadArchivedTasks();
    await vi.waitFor(() => expect(mocks.getArchivedTasks).toHaveBeenCalledOnce());
    finishArchived(archivedTasks);
    await Promise.all([first, second]);

    expect(manager.tasks.size).toBe(916);
    mocks.restoreTask.mockResolvedValue({ restoredTaskIds: ['archived-0'] });
    await manager.restoreTask('archived-0');
    manager.unloadArchivedTasks();
    expect(manager.tasks.size).toBe(34);
    const restored = manager.tasks.get('archived-0');
    if (!restored) throw new Error('Expected restored task to remain loaded');
    expect(registeredTaskData(restored)?.archivedAt).toBeUndefined();

    manager.dispose();
  });

  it('coalesces consecutive sync completions without concurrent refreshes', async () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    let finishFirst!: (value: { success: true; data: { taskPullRequests: [] } }) => void;
    mocks.getPullRequestsForProjectTasks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockResolvedValue({ success: true, data: { taskPullRequests: [] } });

    const listener = mocks.listeners.get(prSyncProgressChannel.name);
    expect(listener).toBeDefined();
    const done = { remoteUrl: repositoryUrl, kind: 'incremental', status: 'done' } as const;
    listener?.(done);
    listener?.(done);
    listener?.(done);

    expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledTimes(1);
    finishFirst({ success: true, data: { taskPullRequests: [] } });
    await vi.waitFor(() => {
      expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();
    expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it('does not reload the project snapshot after a single-PR sync', () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    const listener = mocks.listeners.get(prSyncProgressChannel.name);
    expect(listener).toBeDefined();

    listener?.({ remoteUrl: repositoryUrl, kind: 'single', status: 'done', synced: 1 });

    expect(mocks.getPullRequestsForProjectTasks).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('keeps an incremental PR update visible while an older bulk snapshot is in flight', async () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    const task = makeTask('Task');
    task.taskBranch = 'feature/task';
    manager.tasks.set(task.id, createUnprovisionedTask(task));
    const store = manager.tasks.get(task.id);
    if (!store) throw new Error('Expected task store');

    let finishFirst!: (value: {
      success: true;
      data: { taskPullRequests: Array<{ taskId: string; prs: PullRequest[] }> };
    }) => void;
    let finishTrailing!: (value: {
      success: true;
      data: { taskPullRequests: Array<{ taskId: string; prs: PullRequest[] }> };
    }) => void;
    mocks.getPullRequestsForProjectTasks
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishTrailing = resolve;
          })
      )
      .mockResolvedValue({ success: true, data: { taskPullRequests: [] } });

    const bulkListener = mocks.listeners.get(prSyncProgressChannel.name);
    bulkListener?.({ remoteUrl: repositoryUrl, kind: 'incremental', status: 'done' });

    const stalePr = makePullRequest(repositoryUrl, 'feature/task');
    stalePr.title = 'Stale bulk value';
    const freshPr = makePullRequest(repositoryUrl, 'feature/task');
    freshPr.title = 'Fresh incremental value';
    const updateListener = mocks.listeners.get(prUpdatedChannel.name);
    updateListener?.({ prs: [freshPr] });

    finishFirst({
      success: true,
      data: { taskPullRequests: [{ taskId: task.id, prs: [stalePr] }] },
    });
    await vi.waitFor(() => {
      expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledTimes(2);
    });
    expect(registeredTaskData(store)?.prs).toEqual([freshPr]);

    finishTrailing({
      success: true,
      data: { taskPullRequests: [{ taskId: task.id, prs: [freshPr] }] },
    });
    await vi.waitFor(() => {
      expect(registeredTaskData(store)?.prs).toEqual([freshPr]);
    });
    manager.dispose();
  });

  it('reloads pull requests when an archived task is restored', async () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    const task = makeTask('Archived task');
    task.taskBranch = 'feature/task';
    task.archivedAt = '2026-06-06T10:00:00.000Z';
    manager.tasks.set(task.id, createUnprovisionedTask(task));
    const store = manager.tasks.get(task.id);
    if (!store) throw new Error('Expected task store');
    const pr = makePullRequest(repositoryUrl, 'feature/task');
    mocks.restoreTask.mockResolvedValue({ restoredTaskIds: [task.id] });
    mocks.getPullRequestsForProjectTasks.mockResolvedValue({
      success: true,
      data: { taskPullRequests: [{ taskId: task.id, prs: [pr] }] },
    });

    await manager.restoreTask(task.id);

    expect(registeredTaskData(store)?.archivedAt).toBeUndefined();
    expect(registeredTaskData(store)?.prs).toEqual([pr]);
    expect(mocks.getPullRequestsForProjectTasks).toHaveBeenCalledWith('project-1', repositoryUrl);
    manager.dispose();
  });

  it('point-loads an archived task before restoring it', async () => {
    const manager = createManager();
    manager.taskLoadState = 'loaded';
    const task = makeTask('Archived task');
    task.archivedAt = '2026-06-06T10:00:00.000Z';
    mocks.getTask.mockResolvedValue(task);
    mocks.restoreTask.mockResolvedValue({ restoredTaskIds: [task.id] });

    await manager.restoreTask(task.id);

    expect(mocks.getTask).toHaveBeenCalledWith('project-1', task.id);
    expect(mocks.restoreTask).toHaveBeenCalledWith(task.id);
    const restored = manager.tasks.get(task.id);
    if (!restored) throw new Error('Expected restored task to be loaded');
    expect(registeredTaskData(restored)?.archivedAt).toBeUndefined();
    manager.dispose();
  });

  it('does not hydrate archived tasks from incremental PR events', () => {
    const repositoryUrl = 'https://github.com/lovstudio/yoda';
    const manager = createManager(repositoryUrl);
    const active = makeTask('Active', undefined, 'task-active');
    active.taskBranch = 'feature/shared';
    const archived = makeTask('Archived', undefined, 'task-archived');
    archived.taskBranch = 'feature/shared';
    archived.archivedAt = '2026-06-06T10:00:00.000Z';
    manager.tasks.set(active.id, createUnprovisionedTask(active));
    manager.tasks.set(archived.id, createUnprovisionedTask(archived));

    const pr = makePullRequest(repositoryUrl, 'feature/shared');
    const listener = mocks.listeners.get(prUpdatedChannel.name);
    expect(listener).toBeDefined();
    listener?.({ prs: [pr] });

    const activeStore = manager.tasks.get(active.id);
    const archivedStore = manager.tasks.get(archived.id);
    if (!activeStore || !archivedStore) throw new Error('Expected both task stores');
    expect(registeredTaskData(activeStore)?.prs).toEqual([pr]);
    expect(registeredTaskData(archivedStore)?.prs).toEqual([]);
    expect(mocks.getPullRequestsForProjectTasks).not.toHaveBeenCalled();
    manager.dispose();
  });
});

describe('TaskManagerStore task hierarchy index', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('indexes direct children and reacts to re-parenting', () => {
    const manager = createManager();
    const parent = createUnprovisionedTask(makeTask('Parent'));
    const child = createUnprovisionedTask(makeTask('Child', 'task-1', 'task-2'));
    const otherParent = createUnprovisionedTask(makeTask('Other parent', undefined, 'task-3'));

    manager.tasks.set('task-1', parent);
    manager.tasks.set('task-2', child);
    manager.tasks.set('task-3', otherParent);

    expect(manager.childrenByParent.get('task-1')).toEqual([child]);
    expect(manager.childrenByParent.get('task-3')).toBeUndefined();

    const childData = registeredTaskData(child);
    if (!childData) throw new Error('Expected child task data to be registered');
    childData.parentTaskId = 'task-3';

    expect(manager.childrenByParent.get('task-1')).toBeUndefined();
    expect(manager.childrenByParent.get('task-3')).toEqual([child]);
    manager.dispose();
  });
});

describe('TaskManagerStore review index', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('returns only active registered tasks needing review', () => {
    const manager = createManager();
    const pending = createUnprovisionedTask(makeTask('Pending review', undefined, 'task-1'));
    pending.data.needsReview = true;
    const archived = createUnprovisionedTask(makeTask('Archived', undefined, 'task-2'));
    archived.data.needsReview = true;
    const archivedData = registeredTaskData(archived);
    if (!archivedData) throw new Error('Expected archived task data to be registered');
    archivedData.archivedAt = '2026-06-06T10:00:00.000Z';
    const archiving = createUnprovisionedTask(makeTask('Archiving', undefined, 'task-3'));
    archiving.data.needsReview = true;
    const archivingData = registeredTaskData(archiving);
    if (!archivingData) throw new Error('Expected archiving task data to be registered');
    archivingData.archiveRequestedAt = '2026-06-06T10:00:00.000Z';

    manager.tasks.set('task-1', pending);
    manager.tasks.set('task-2', archived);
    manager.tasks.set('task-3', archiving);

    expect(manager.tasksNeedingReview).toEqual([pending]);
    pending.data.needsReview = false;
    expect(manager.tasksNeedingReview).toEqual([]);
    manager.dispose();
  });
});

describe('TaskManagerStore task view preload', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('deduplicates lightweight task data without provisioning the workspace', async () => {
    const manager = createManager();
    manager.tasks.set('task-1', createUnprovisionedTask(makeTask('Task')));
    mocks.viewStateGet.mockResolvedValue({ activeTabId: 'overview' });

    await Promise.all([manager.preloadTask('task-1'), manager.preloadTask('task-1')]);

    expect(mocks.viewStateGet).toHaveBeenCalledTimes(1);
    expect(mocks.viewStateGet).toHaveBeenCalledWith('task:task-1');
    expect(mocks.getConversationsForTask).not.toHaveBeenCalled();
    expect(mocks.provisionTask).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('uses conversations returned by the single provision RPC', async () => {
    const manager = createManager();
    const store = createUnprovisionedTask(makeTask('Task'));
    const transitionToProvisioned = vi
      .spyOn(store, 'transitionToProvisioned')
      .mockImplementation(() => {});
    const conversations: Conversation[] = [
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        title: 'Codex',
        lastInteractedAt: '2026-06-05T10:00:00.000Z',
        isInitialConversation: true,
      },
    ];
    manager.tasks.set('task-1', store);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.getActiveTasks.mockResolvedValue([]);
    mocks.viewStateGet.mockResolvedValue({ activeTabId: 'overview' });
    mocks.provisionTask.mockResolvedValue({
      path: '/repo/task-1',
      workspaceId: 'workspace-1',
      sshConnectionId: undefined,
      conversations,
    });

    await Promise.all([manager.preloadTask('task-1'), manager.provisionTask('task-1')]);

    expect(mocks.viewStateGet).toHaveBeenCalledTimes(1);
    expect(mocks.provisionTask).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationsForTask).not.toHaveBeenCalled();
    expect(transitionToProvisioned.mock.calls[0]?.[7]).toEqual(conversations);
    manager.dispose();
  });

  it('shares one provisioning run before project mounting finishes', async () => {
    const manager = createManager();
    const store = createUnprovisionedTask(makeTask('Task'));
    vi.spyOn(store, 'transitionToProvisioned').mockImplementation(() => {});
    manager.tasks.set('task-1', store);

    let resolveMount!: () => void;
    mocks.mountProject.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveMount = resolve;
      })
    );
    mocks.getActiveTasks.mockResolvedValue([]);
    mocks.viewStateGet.mockResolvedValue(undefined);
    mocks.provisionTask.mockResolvedValue({
      path: '/repo/task-1',
      workspaceId: 'workspace-1',
      sshConnectionId: undefined,
      conversations: [],
    });

    const first = manager.provisionTask('task-1');
    const second = manager.provisionTask('task-1');

    expect(second).toBe(first);
    expect(mocks.mountProject).toHaveBeenCalledOnce();
    expect(mocks.provisionTask).not.toHaveBeenCalled();

    resolveMount();
    await Promise.all([first, second]);

    expect(mocks.provisionTask).toHaveBeenCalledOnce();
    manager.dispose();
  });
});

describe('TaskManagerStore disposal', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.unsubscribers.length = 0;
  });

  it('unsubscribes every event listener and disposes every owned task once', () => {
    const manager = createManager();
    const disposeTask = vi.fn();
    manager.tasks.set('task-1', {
      state: 'unprovisioned',
      data: makeTask('Task'),
      dispose: disposeTask,
    } as unknown as TaskStore);
    const unsubscribers = [...mocks.unsubscribers];

    expect(unsubscribers).toHaveLength(11);
    manager.dispose();
    manager.dispose();

    for (const unsubscribe of unsubscribers) {
      expect(unsubscribe).toHaveBeenCalledOnce();
    }
    expect(disposeTask).toHaveBeenCalledOnce();
    expect(manager.tasks.size).toBe(0);
  });

  it('does not repopulate tasks when a pending load finishes after disposal', async () => {
    let finishLoad!: (tasks: Task[]) => void;
    mocks.getActiveTasks.mockReturnValue(
      new Promise<Task[]>((resolve) => {
        finishLoad = resolve;
      })
    );
    const manager = createManager();
    const pending = manager.loadTasks();

    manager.dispose();
    finishLoad([makeTask('Late task')]);
    await pending;

    expect(manager.tasks.size).toBe(0);
  });
});

function createManager(repositoryUrl: string | null = null): TaskManagerStore {
  const repository = observable({ repositoryUrl }) as unknown as RepositoryStore;
  const settings = {
    pageData: {
      invalidate: mocks.invalidatePageData,
    },
  } as unknown as ProjectSettingsStore;
  return new TaskManagerStore('project-1', repository, settings, 'main');
}

function emitTaskRenamed(name: string): void {
  const listener = mocks.listeners.get(taskRenamedChannel.name);
  expect(listener).toBeDefined();
  listener?.({
    taskId: 'task-1',
    projectId: 'project-1',
    name,
    isUserNamed: true,
  });
}

function emitTaskCreated(): void {
  const listener = mocks.listeners.get(taskCreatedChannel.name);
  expect(listener).toBeDefined();
  listener?.({ taskId: 'task-1', projectId: 'project-1' });
}

function emitTaskStatusUpdated(status: Task['status']): void {
  const listener = mocks.listeners.get(taskStatusUpdatedChannel.name);
  expect(listener).toBeDefined();
  listener?.({ taskId: 'task-1', projectId: 'project-1', status });
}

function makeCreateTaskParams(name: string): CreateTaskParams {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name,
    sourceBranch: { type: 'local', branch: 'main' },
    strategy: { kind: 'no-worktree' },
  };
}

function makeTask(name: string, parentTaskId?: string, id = 'task-1'): Task {
  return {
    id,
    projectId: 'project-1',
    name,
    parentTaskId,
    status: 'in_progress',
    sourceBranch: { type: 'local', branch: 'main' },
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
    statusChangedAt: '2026-06-05T10:00:00.000Z',
    lastInteractedAt: '2026-06-05T10:00:00.000Z',
    isPinned: false,
    isFavorite: false,
    isLongTerm: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}

function makePullRequest(repositoryUrl: string, headRefName: string): PullRequest {
  return {
    url: `${repositoryUrl}/pull/1`,
    provider: 'github',
    repositoryUrl,
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: repositoryUrl,
    headRefName,
    headRefOid: 'head',
    identifier: '#1',
    title: 'PR',
    description: null,
    status: 'open',
    isDraft: false,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commitCount: 1,
    mergeableStatus: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: null,
    createdAt: '2026-06-05T10:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
  };
}
