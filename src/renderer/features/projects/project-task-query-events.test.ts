import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  taskArchivedChannel,
  taskCreatedChannel,
  taskDeletedChannel,
  taskMovedChannel,
  taskRenamedChannel,
  taskRestoredChannel,
} from '@shared/events/taskEvents';
import { subscribeProjectTaskQueryInvalidation } from './project-task-query-events';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: never) => void>(),
  disposers: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((channel: { name: string }, listener: (event: never) => void) => {
      mocks.listeners.set(channel.name, listener);
      const dispose = vi.fn();
      mocks.disposers.push(dispose);
      return dispose;
    }),
  },
}));

describe('project task query invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.disposers.length = 0;
  });

  it('invalidates counts and session metadata for every relevant task mutation', () => {
    const invalidateCounts = vi.fn();
    const invalidateSessions = vi.fn();
    const dispose = subscribeProjectTaskQueryInvalidation({
      onTaskCountsInvalidated: invalidateCounts,
      onProjectSessionsInvalidated: invalidateSessions,
    });

    emit(taskCreatedChannel.name, { projectId: 'project-1', taskId: 'task-1' });
    emit(taskArchivedChannel.name, { projectId: 'project-1', taskId: 'task-1' });
    emit(taskRestoredChannel.name, { projectId: 'project-1', restoredTaskIds: ['task-1'] });
    emit(taskDeletedChannel.name, { projectId: 'project-1', taskId: 'task-1' });
    emit(taskRenamedChannel.name, {
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Renamed',
      isUserNamed: true,
    });
    emit(taskMovedChannel.name, {
      taskId: 'task-1',
      sourceProjectId: 'project-1',
      targetProjectId: 'project-2',
    });

    expect(invalidateCounts).toHaveBeenCalledTimes(5);
    expect(invalidateSessions).toHaveBeenCalledTimes(6);
    expect(invalidateSessions).toHaveBeenNthCalledWith(1, 'project-1');

    dispose();
    for (const disposer of mocks.disposers) expect(disposer).toHaveBeenCalledOnce();
  });
});

function emit(name: string, event: unknown): void {
  const listener = mocks.listeners.get(name);
  if (!listener) throw new Error(`Missing listener for ${name}`);
  listener(event as never);
}
