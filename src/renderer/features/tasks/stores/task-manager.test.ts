import { afterEach, describe, expect, it, vi } from 'vitest';
import { taskRenamedChannel } from '@shared/events/taskEvents';
import type { CreateTaskParams, Task } from '@shared/tasks';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { createUnregisteredTask } from './task';
import { TaskManagerStore } from './task-manager';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getConversationsForTask: vi.fn(),
  getPullRequestsForTask: vi.fn(),
  getTasks: vi.fn(),
  invalidatePageData: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
  mountProject: vi.fn(),
  provisionTask: vi.fn(),
  viewStateSet: vi.fn(),
  viewStateGet: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, cb: (data: unknown) => void) => {
      mocks.listeners.set(event.name, cb);
      return vi.fn();
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

describe('TaskManagerStore external task reconciliation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
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
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
