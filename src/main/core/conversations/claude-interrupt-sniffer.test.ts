import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notePtyRepaint, PTY_ATTACH_REPAINT_WINDOW_MS } from '@main/core/pty/pty-repaint-window';
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
  let ptySessionId = 'pty-1';
  let ptySessionCounter = 0;

  /**
   * A sniffer on a settled session: no repaint window is open, so its output is
   * live rendering rather than a replay of what is already on screen.
   */
  const settled = () => createClaudeInterruptSniffer({ ...session, ptySessionId });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.getStatus.mockReturnValue('working');
    // The repaint window is module state; a fresh id per test keeps them apart.
    ptySessionId = `pty-${++ptySessionCounter}`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears working for the current Claude interruption prompt', () => {
    const onData = settled();

    onData('Conversation interrupted – tell Claude what to do differently');

    expect(mocks.markInterrupted).toHaveBeenCalledWith(session.conversationId);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      session,
      { kind: 'turn-interrupted', at: expect.any(Number) },
      'interrupt-sniffer'
    );
  });

  it('clears working for the current Codex interruption prompt', () => {
    const onData = settled();

    onData('■ Conversation interrupted - tell the model what to do differently.');

    expect(mocks.markInterrupted).toHaveBeenCalledWith(session.conversationId);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      session,
      { kind: 'turn-interrupted', at: expect.any(Number) },
      'interrupt-sniffer'
    );
  });

  it('keeps recognizing the Claude prompt and markers split across PTY chunks', () => {
    const onData = settled();

    onData('Interrupted · What should Claude do ');
    onData('instead?');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('clears awaiting-input when the TUI reports an interruption', () => {
    mocks.getStatus.mockReturnValue('awaiting-input');
    const onData = settled();

    onData('Conversation interrupted - tell Claude what to do differently.');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('does not clear a session that is already idle', () => {
    mocks.getStatus.mockReturnValue('idle');
    const onData = settled();

    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.markInterrupted).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('ignores an interruption line replayed by a resize repaint', () => {
    const onData = settled();

    // Opening a working task resizes its terminal; tmux answers by re-emitting
    // the whole pane, including a previous turn's interruption line.
    notePtyRepaint(ptySessionId);
    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.markInterrupted).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('recognizes a real interruption once the repaint window has passed', () => {
    const onData = settled();

    notePtyRepaint(ptySessionId);
    onData('Conversation interrupted - tell the model what to do differently.');
    vi.advanceTimersByTime(2_000);
    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it('ignores the interruption line dumped by a tmux attach', () => {
    const onData = createClaudeInterruptSniffer({ ...session, ptySessionId });

    // The PTY registry opens the attach window when it registers the wrapper.
    notePtyRepaint(ptySessionId, PTY_ATTACH_REPAINT_WINDOW_MS);
    onData('some earlier output\r\n');
    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('recognizes an interruption typed after a long bursty turn', () => {
    const onData = settled();

    // A working turn's own output is bursty on the same timescale as an attach
    // dump, so quiet gaps must never be treated as evidence of a replay.
    for (let index = 0; index < 40; index += 1) {
      onData(`tool call ${index}\r\n`);
      vi.advanceTimersByTime(index % 7 === 0 ? 900 : 60);
    }
    onData('Conversation interrupted - tell the model what to do differently.');

    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });
});
