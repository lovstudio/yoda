import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interruptConversation } from './interruptConversation';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getPty: vi.fn(),
  getStatus: vi.fn(),
  isAutoReconcileStale: vi.fn(),
  markInterrupted: vi.fn(),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: mocks.getPty },
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    dispatch: mocks.dispatch,
    getStatus: mocks.getStatus,
  },
}));

vi.mock('./agent-silence-reconciler', () => ({
  agentSilenceReconciler: {
    isAutoReconcileStale: mocks.isAutoReconcileStale,
  },
}));

vi.mock('./interrupt-marker', () => ({
  markInterrupted: mocks.markInterrupted,
}));

describe('interruptConversation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.getStatus.mockReturnValue('idle');
  });

  it('sends Esc to a silent session whose run state is authoritative', () => {
    const write = vi.fn();
    mocks.getPty.mockReturnValue({ write });
    mocks.isAutoReconcileStale.mockReturnValue(false);

    interruptConversation('project-1', 'task-1', 'conversation-1');

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith('\x1b');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('clears a silent heuristic session without sending Esc', () => {
    const write = vi.fn();
    mocks.getPty.mockReturnValue({ write });
    mocks.isAutoReconcileStale.mockReturnValue(true);

    interruptConversation('project-1', 'task-1', 'conversation-1');

    expect(write).not.toHaveBeenCalled();
    expect(mocks.markInterrupted).toHaveBeenCalledWith('conversation-1');
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
