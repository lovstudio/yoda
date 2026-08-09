import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { reclaimTaskRuntime } from './task-runtime-reclamation';

const mocks = vi.hoisted(() => ({
  cleanupDetachedSessions: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  cleanupDetachedSessions: mocks.cleanupDetachedSessions,
  taskManager: { teardownTask: mocks.teardownTask },
}));

describe('reclaimTaskRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.teardownTask.mockResolvedValue({ success: true, data: undefined });
    mocks.cleanupDetachedSessions.mockResolvedValue(undefined);
  });

  it('awaits teardown before sweeping detached sessions', async () => {
    const order: string[] = [];
    mocks.teardownTask.mockImplementation(async () => {
      order.push('teardown');
      return { success: true, data: undefined };
    });
    mocks.cleanupDetachedSessions.mockImplementation(async () => {
      order.push('detached-sessions');
    });

    const result = await reclaimTaskRuntime('project-1', 'task-1', {} as IExecutionContext);

    expect(result).toEqual({ confirmed: true, failures: [] });
    expect(order).toEqual(['teardown', 'detached-sessions']);
  });

  it('still runs the detached-session sweep after teardown fails', async () => {
    mocks.teardownTask.mockResolvedValue({
      success: false,
      error: { message: 'workspace release failed' },
    });

    const result = await reclaimTaskRuntime('project-1', 'task-1', {} as IExecutionContext);

    expect(mocks.cleanupDetachedSessions).toHaveBeenCalledOnce();
    expect(result.confirmed).toBe(false);
    expect(result.failures).toEqual([{ stage: 'teardown', error: 'workspace release failed' }]);
  });

  it('fails closed when the detached-session sweep cannot be confirmed', async () => {
    mocks.cleanupDetachedSessions.mockRejectedValue(new Error('database unavailable'));

    const result = await reclaimTaskRuntime('project-1', 'task-1', {} as IExecutionContext);

    expect(result.confirmed).toBe(false);
    expect(result.failures).toEqual([
      { stage: 'detached-sessions', error: 'Error: database unavailable' },
    ]);
  });
});
