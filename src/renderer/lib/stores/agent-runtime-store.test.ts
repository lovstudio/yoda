import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionStatusChangedChannel } from '@shared/events/agentEvents';
import { AgentRuntimeStore } from './agent-runtime-store';

const mocks = vi.hoisted(() => ({
  getActiveRuntimeStatuses: vi.fn(),
  listener: undefined as ((event: Record<string, string>) => void) | undefined,
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, listener: (event: Record<string, string>) => void) => {
      mocks.listener = listener;
      return () => {};
    }),
  },
  rpc: {
    conversations: {
      getActiveRuntimeStatuses: mocks.getActiveRuntimeStatuses,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn() },
}));

describe('AgentRuntimeStore task session display state', () => {
  beforeEach(() => {
    mocks.listener = undefined;
    mocks.getActiveRuntimeStatuses.mockReset();
    mocks.getActiveRuntimeStatuses.mockResolvedValue({
      coveredProjectIds: [],
      entries: [],
    });
  });

  it('keeps mixed session states and hides consumed terminal notifications', async () => {
    const store = new AgentRuntimeStore();
    await store.start();

    emitStatus('working', 'working-1');
    emitStatus('completed', 'completed-1');

    expect(store.isTaskUnread('project-1', 'task-1')).toBe(true);
    expect(store.taskSessionStatuses('project-1', 'task-1')).toEqual([
      { conversationId: 'working-1', status: 'working' },
      { conversationId: 'completed-1', status: 'completed' },
    ]);

    store.markTaskSeen('project-1', 'task-1');

    expect(store.isTaskUnread('project-1', 'task-1')).toBe(false);
    expect(store.taskSessionStatuses('project-1', 'task-1')).toEqual([
      { conversationId: 'working-1', status: 'working' },
    ]);
  });

  it('restores attention state when any session needs input', async () => {
    const store = new AgentRuntimeStore();
    await store.start();
    emitStatus('completed', 'completed-1');
    store.markTaskSeen('project-1', 'task-1');

    emitStatus('awaiting-input', 'awaiting-1');

    expect(store.isTaskUnread('project-1', 'task-1')).toBe(true);
    expect(store.taskSessionStatuses('project-1', 'task-1')).toEqual([
      { conversationId: 'completed-1', status: 'completed' },
      { conversationId: 'awaiting-1', status: 'awaiting-input' },
    ]);
  });

  it('forgets acknowledgement state when tasks or projects leave the graph', async () => {
    const store = new AgentRuntimeStore();
    await store.start();
    emitStatus('completed', 'conversation-1', 'project-1', 'task-1');
    emitStatus('completed', 'conversation-2', 'project-1', 'task-2');
    store.markTaskSeen('project-1', 'task-1');
    store.markTaskSeen('project-1', 'task-2');

    store.forgetTask('project-1', 'task-1');
    expect(store.isTaskUnread('project-1', 'task-1')).toBe(true);
    expect(store.isTaskUnread('project-1', 'task-2')).toBe(false);

    store.forgetProject('project-1');
    expect(store.isTaskUnread('project-1', 'task-2')).toBe(true);
  });

  it('drops idle sessions from the active index', async () => {
    const store = new AgentRuntimeStore();
    await store.start();
    emitStatus('working', 'conversation-1');

    expect(store.sessionStatus('project-1', 'task-1', 'conversation-1')).toBe('working');

    emitStatus('idle', 'conversation-1');

    expect(store.taskStatus('project-1', 'task-1')).toBeNull();
    expect(store.taskSessionStatuses('project-1', 'task-1')).toEqual([]);
    expect(store.workingConversationIds('project-1', 'task-1')).toEqual([]);
    expect(store.sessionStatus('project-1', 'task-1', 'conversation-1')).toBeNull();
  });

  it('hides terminal tab indicators after the task has been seen', async () => {
    const store = new AgentRuntimeStore();
    await store.start();
    emitStatus('completed', 'conversation-1');

    expect(store.sessionStatus('project-1', 'task-1', 'conversation-1')).toBe('completed');

    store.markTaskSeen('project-1', 'task-1');

    expect(store.sessionStatus('project-1', 'task-1', 'conversation-1')).toBeNull();
  });

  it('exposes routing identities for every globally running session', async () => {
    const store = new AgentRuntimeStore();
    await store.start();
    emitStatus('completed', 'completed-1', 'project-3', 'task-3');
    emitStatus('working', 'working-1', 'project-2', 'task-2');
    emitStatus('awaiting-input', 'awaiting-1', 'project-1', 'task-1');

    expect(store.runningSessions()).toEqual([
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'awaiting-1',
        status: 'awaiting-input',
      },
      {
        projectId: 'project-2',
        taskId: 'task-2',
        conversationId: 'working-1',
        status: 'working',
      },
    ]);
  });

  it('hydrates active unopened tasks without mounting their task stores', async () => {
    mocks.getActiveRuntimeStatuses.mockResolvedValueOnce({
      coveredProjectIds: ['project-1'],
      entries: [
        {
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'working-1',
          status: 'working',
        },
      ],
    });
    const store = new AgentRuntimeStore();

    await store.start();
    await store.hydrateActiveSessions();

    expect(store.isTaskRunning('project-1', 'task-1')).toBe(true);
    expect(mocks.getActiveRuntimeStatuses).toHaveBeenCalledWith(undefined);
  });

  it('keeps remote hydration passive until the primary window enables it', async () => {
    const store = new AgentRuntimeStore();
    await store.start();

    await store.hydrateProject('project-1');

    expect(mocks.getActiveRuntimeStatuses).not.toHaveBeenCalled();
  });

  it('keeps a live event that arrives while the startup snapshot is loading', async () => {
    let resolveSnapshot:
      | ((value: {
          coveredProjectIds: string[];
          entries: Array<{
            projectId: string;
            taskId: string;
            conversationId: string;
            status: 'working';
          }>;
        }) => void)
      | undefined;
    mocks.getActiveRuntimeStatuses.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      })
    );
    const store = new AgentRuntimeStore();
    await store.start();
    const hydration = store.hydrateActiveSessions();
    emitStatus('awaiting-input', 'conversation-1');

    resolveSnapshot?.({
      coveredProjectIds: ['project-1'],
      entries: [
        {
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'conversation-1',
          status: 'working',
        },
      ],
    });
    await hydration;

    expect(store.taskStatus('project-1', 'task-1')).toBe('awaiting-input');
  });

  it('removes stale entries when a covered host no longer reports them', async () => {
    mocks.getActiveRuntimeStatuses.mockResolvedValueOnce({
      coveredProjectIds: ['project-1'],
      entries: [
        {
          projectId: 'project-1',
          taskId: 'task-1',
          conversationId: 'working-1',
          status: 'working',
        },
      ],
    });
    const store = new AgentRuntimeStore();
    await store.start();
    await store.hydrateActiveSessions();
    mocks.getActiveRuntimeStatuses.mockResolvedValueOnce({
      coveredProjectIds: ['project-1'],
      entries: [],
    });

    await store.hydrateProject('project-1');

    expect(store.taskStatus('project-1', 'task-1')).toBeNull();
    expect(mocks.getActiveRuntimeStatuses).toHaveBeenLastCalledWith('project-1');
  });
});

function emitStatus(
  status: string,
  conversationId: string,
  projectId = 'project-1',
  taskId = 'task-1'
): void {
  expect(mocks.listener, agentSessionStatusChangedChannel.name).toBeDefined();
  mocks.listener?.({
    projectId,
    taskId,
    conversationId,
    status,
  });
}
