import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaudeInterruptSniffer } from './claude-interrupt-sniffer';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getStatus: vi.fn(),
  markInterrupted: vi.fn(),
}));

vi.mock('./agent-session-runtime', () => ({
  agentSessionRuntimeStore: {
    dispatch: mocks.dispatch,
    getStatus: mocks.getStatus,
  },
}));

vi.mock('./interrupt-marker', () => ({
  markInterrupted: mocks.markInterrupted,
}));

vi.mock('@main/lib/logger', () => ({
  log: { debug: vi.fn() },
}));

describe('createClaudeInterruptSniffer', () => {
  const session = {
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStatus.mockReturnValue('working');
  });

  it('clears working for the current Codex interruption prompt', () => {
    const onData = createClaudeInterruptSniffer(session);

    onData('■ Conversation interrupted - tell the model what to do differently.');

    expect(mocks.markInterrupted).toHaveBeenCalledWith(session.conversationId);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      session,
      { kind: 'turn-interrupted', at: expect.any(Number) },
      'interrupt-sniffer'
    );
  });

  it('keeps recognizing the Claude prompt and markers split across PTY chunks', () => {
    const onData = createClaudeInterruptSniffer(session);

    onData('Interrupted · What should Claude do ');
    onData('instead?');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('clears awaiting-input when the TUI reports an interruption', () => {
    mocks.getStatus.mockReturnValue('awaiting-input');
    const onData = createClaudeInterruptSniffer(session);

    onData('Conversation interrupted - tell Claude what to do differently.');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('does not clear a session that is already idle', () => {
    mocks.getStatus.mockReturnValue('idle');
    const onData = createClaudeInterruptSniffer(session);

    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.markInterrupted).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
