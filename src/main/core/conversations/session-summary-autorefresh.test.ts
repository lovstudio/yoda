import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionStatusChanged } from '@shared/events/agentEvents';
import { sessionSummaryAutoRefreshService } from './session-summary-autorefresh';

const mocks = vi.hoisted(() => ({
  listener: null as ((event: AgentSessionStatusChanged) => void) | null,
  refresh: vi.fn(async () => null),
}));

vi.mock('@main/lib/events', () => ({
  events: {
    on: (_channel: unknown, listener: (event: AgentSessionStatusChanged) => void) => {
      mocks.listener = listener;
      return () => {
        if (mocks.listener === listener) mocks.listener = null;
      };
    },
  },
}));

vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));
vi.mock('./session-summary-context', () => ({
  refreshConversationSummary: mocks.refresh,
}));

const event: AgentSessionStatusChanged = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
  status: 'completed',
};

describe('session summary auto refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.refresh.mockClear();
    sessionSummaryAutoRefreshService.initialize();
  });

  afterEach(() => {
    sessionSummaryAutoRefreshService.dispose();
    vi.useRealTimers();
  });

  it('refreshes only after a completed session settles', async () => {
    mocks.listener?.({ ...event, status: 'idle' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(mocks.refresh).not.toHaveBeenCalled();

    mocks.listener?.(event);
    await vi.advanceTimersByTimeAsync(1_199);
    expect(mocks.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.refresh).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
      'global'
    );
  });

  it('debounces duplicate completion events for the same conversation', async () => {
    mocks.listener?.(event);
    await vi.advanceTimersByTimeAsync(800);
    mocks.listener?.(event);
    await vi.advanceTimersByTimeAsync(1_200);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
