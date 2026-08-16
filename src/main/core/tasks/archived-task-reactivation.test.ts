import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentSessionStatusChangedChannel,
  type AgentSessionStatusChanged,
} from '@shared/events/agentEvents';
import { archivedTaskReactivationService } from './archived-task-reactivation';

const mocks = vi.hoisted(() => ({
  eventListeners: new Map<string, (event: unknown) => void>(),
  restoreTaskWithoutDescendants: vi.fn(),
  taskRows: [] as Array<{ archivedAt: string | null }>,
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.taskRows),
        })),
      })),
    })),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    on: vi.fn((channel: { name: string }, listener: (event: unknown) => void): (() => void) => {
      mocks.eventListeners.set(channel.name, listener);
      return vi.fn();
    }),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock('./operations/restoreTask', () => ({
  restoreTaskWithoutDescendants: mocks.restoreTaskWithoutDescendants,
}));

function emitStatus(status: AgentSessionStatusChanged['status']): void {
  const listener = mocks.eventListeners.get(agentSessionStatusChangedChannel.name);
  if (!listener) throw new Error('service did not subscribe to agent status changes');
  listener({
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    status,
  } satisfies AgentSessionStatusChanged);
}

describe('archivedTaskReactivationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventListeners.clear();
    mocks.taskRows = [{ archivedAt: '2026-08-16 03:48:54' }];
    mocks.restoreTaskWithoutDescendants.mockResolvedValue(true);
    archivedTaskReactivationService.dispose();
    archivedTaskReactivationService.initialize();
  });

  it('restores an archived task once its agent starts working', async () => {
    emitStatus('working');
    await vi.waitFor(() =>
      expect(mocks.restoreTaskWithoutDescendants).toHaveBeenCalledWith('task-1')
    );
  });

  it('restores an archived task that is blocked on the user', async () => {
    emitStatus('awaiting-input');
    await vi.waitFor(() =>
      expect(mocks.restoreTaskWithoutDescendants).toHaveBeenCalledWith('task-1')
    );
  });

  it('leaves an archived task archived for statuses that are not a live turn', async () => {
    emitStatus('completed');
    emitStatus('idle');
    emitStatus('interrupted');
    await Promise.resolve();
    expect(mocks.restoreTaskWithoutDescendants).not.toHaveBeenCalled();
  });

  it('does not touch a task that was never archived', async () => {
    mocks.taskRows = [{ archivedAt: null }];
    emitStatus('working');
    await vi.waitFor(() => expect(mocks.restoreTaskWithoutDescendants).not.toHaveBeenCalled());
  });
});
