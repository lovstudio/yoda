import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentSessionStatusChangedChannel } from '@shared/events/agentEvents';
import { AgentRuntimeStore } from './agent-runtime-store';

const mocks = vi.hoisted(() => ({
  listener: undefined as ((event: Record<string, string>) => void) | undefined,
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, listener: (event: Record<string, string>) => void) => {
      mocks.listener = listener;
      return () => {};
    }),
  },
}));

describe('AgentRuntimeStore task session display state', () => {
  beforeEach(() => {
    mocks.listener = undefined;
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
});

function emitStatus(status: string, conversationId: string): void {
  expect(mocks.listener, agentSessionStatusChangedChannel.name).toBeDefined();
  mocks.listener?.({
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId,
    status,
  });
}
