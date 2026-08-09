import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  taskArchivedChannel,
  taskCreatedChannel,
  taskRenamedChannel,
  taskStatusUpdatedChannel,
} from '@shared/events/taskEvents';
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
  getPullRequestsForTask: vi.fn(),
  getTasks: vi.fn(),
  invalidatePageData: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
  unsubscribers: [] as Array<ReturnType<typeof vi.fn>>,
  mountProject: vi.fn(),
  provisionTask: vi.fn(),
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
      getPullRequestsForTask: mocks.getPullRequestsForTask,
    },
    tasks: {
      createTask: mocks.createTask,
      getTasks: mocks.getTasks,
      provisionTask: mocks.provisionTask,
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
    manager.tasks.set('task-1', {
      state: 'provisioned',
      data: makeTask('Task'),
      transitionToUnprovisioned,
      dispose: vi.fn(),
    } as unknown as TaskStore);

    const listener = mocks.listeners.get(taskArchivedChannel.name);
    expect(listener).toBeDefined();
    listener?.({ taskId: 'task-1', projectId: 'project-1' });

    expect(transitionToUnprovisioned).toHaveBeenCalledOnce();
    expect(transitionToUnprovisioned).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', archivedAt: expect.any(String) }),
      'idle'
    );
    manager.dispose();
  });

  it('does not revive an archived task when an earlier provision RPC resolves late', async () => {
    const manager = createManager();
    manager.taskLoadState = 'loaded';
    const store = createUnprovisionedTask(makeTask('Task'));
    manager.tasks.set('task-1', store);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.getTasks.mockResolvedValue([]);
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
    expect(registeredTaskData(store)?.archivedAt).toEqual(expect.any(String));
    expect(store.provisionedTask).toBeNull();
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
    mocks.getTasks.mockResolvedValue([makeTask('Imported session')]);
    mocks.getPullRequestsForTask.mockResolvedValue({ success: false });

    const loaded = await manager.ensureTaskLoaded('task-1');

    expect(loaded).toBe(true);
    expect(mocks.getTasks).toHaveBeenCalledWith('project-1');
    expect(manager.tasks.get('task-1')?.data.name).toBe('Imported session');
    manager.dispose();
  });

  it('reports task loading while imported sessions are being read', async () => {
    const manager = createManager();
    let resolveTasks: ((tasks: Task[]) => void) | undefined;
    mocks.getTasks.mockReturnValue(
      new Promise<Task[]>((resolve) => {
        resolveTasks = resolve;
      })
    );
    mocks.getPullRequestsForTask.mockResolvedValue({ success: false });

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
    mocks.getTasks.mockResolvedValue([makeTask('Created on mobile')]);
    mocks.getPullRequestsForTask.mockResolvedValue({ success: false });

    emitTaskCreated();

    await vi.waitFor(() => {
      expect(manager.tasks.get('task-1')?.data.name).toBe('Created on mobile');
    });
    expect(mocks.getTasks).toHaveBeenCalledWith('project-1');
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
    expect(mocks.getTasks).not.toHaveBeenCalled();
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
    mocks.getTasks.mockResolvedValue([]);
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

    expect(unsubscribers).toHaveLength(8);
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
    mocks.getTasks.mockReturnValue(
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

function createManager(): TaskManagerStore {
  const repository = { repositoryUrl: null } as unknown as RepositoryStore;
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

function makeTask(name: string): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name,
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
