import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentSilenceReconciler } from './agent-silence-reconciler';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(),
  getStatus: vi.fn(),
  markInterrupted: vi.fn(),
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    dispatch: mocks.dispatch,
    getState: mocks.getState,
    getStatus: mocks.getStatus,
  },
}));

vi.mock('./interrupt-marker', () => ({
  markInterrupted: mocks.markInterrupted,
}));

vi.mock('@main/lib/logger', () => ({
  log: { debug: vi.fn() },
}));

const session = {
  projectId: 'project-1',
  taskId: 'task-1',
  conversationId: 'conversation-1',
};

describe('AgentSilenceReconciler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    mocks.getStatus.mockReturnValue('working');
    mocks.getState.mockReturnValue({ updatedAt: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('tracks silence without clearing authoritative working state', () => {
    const reconciler = new AgentSilenceReconciler();
    const detach = reconciler.attach('pty-1', session, { autoReconcile: false });

    vi.advanceTimersByTime(12_000);

    expect(reconciler.isStale('pty-1')).toBe(true);
    expect(reconciler.isAutoReconcileStale('pty-1')).toBe(false);
    expect(mocks.markInterrupted).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    detach();
  });

  it('keeps automatic reconciliation enabled for heuristic sessions by default', () => {
    const reconciler = new AgentSilenceReconciler();
    const detach = reconciler.attach('pty-1', session);

    vi.advanceTimersByTime(12_000);

    expect(reconciler.isAutoReconcileStale('pty-1')).toBe(true);
    expect(mocks.markInterrupted).toHaveBeenCalledWith(session.conversationId);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      session,
      { kind: 'watchdog-idle', at: 12_000 },
      'silence:stale'
    );
    detach();
  });
});
