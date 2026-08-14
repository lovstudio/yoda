import { describe, expect, it, vi } from 'vitest';
import {
  resolveAgentSessionSummaryForShutdown,
  resolveQuitAgentSessionsDecision,
  type ActiveQuitSessionSummary,
} from './quit-agent-sessions';

function summary(
  values: Partial<ActiveQuitSessionSummary> & Pick<ActiveQuitSessionSummary, 'running' | 'keepable'>
): ActiveQuitSessionSummary {
  return {
    agentSessions: values.running,
    terminalSessions: 0,
    nonKeepableSessions: [],
    ...values,
  };
}

function nonKeepableTerminal(name: string) {
  return {
    sessionId: 'project-1:local:project-1:project-view:terminal-1',
    terminalId: 'terminal-1',
    projectId: 'project-1',
    scopeId: 'local:project-1:project-view',
    name,
    detachable: false,
  };
}

function nonKeepableSession(title: string, index: number = 1) {
  return {
    sessionId: `project-1:task-1:conversation-${index}`,
    conversationId: `conversation-${index}`,
    projectId: 'project-1',
    taskId: 'task-1',
    taskTitle: 'Exit prompt task',
    runtimeId: 'codex' as const,
    title,
    detachable: false,
  };
}

function agentSession({
  index,
  status,
  detachable,
  transportAttached,
}: {
  index: number;
  status: 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';
  detachable: boolean;
  transportAttached?: false;
}) {
  return {
    sessionId: `project-1:task-1:conversation-${index}`,
    conversationId: `conversation-${index}`,
    projectId: 'project-1',
    taskId: 'task-1',
    taskTitle: 'Restart protection task',
    runtimeId: 'codex' as const,
    title: `Session ${index}`,
    detachable,
    status,
    statusChangedAt: index,
    ...(transportAttached === false ? { transportAttached } : {}),
  };
}

describe('resolveAgentSessionSummaryForShutdown', () => {
  it('protects idle tmux sessions on restart whether transport is attached or detached', () => {
    const runningSummary = {
      running: 1,
      keepable: 0,
      nonKeepableSessions: [agentSession({ index: 3, status: 'working', detachable: false })],
    };

    const restartSummary = resolveAgentSessionSummaryForShutdown(true, runningSummary, [
      agentSession({ index: 1, status: 'idle', detachable: true }),
      agentSession({
        index: 2,
        status: 'idle',
        detachable: true,
        transportAttached: false,
      }),
      agentSession({ index: 3, status: 'working', detachable: false }),
      agentSession({ index: 4, status: 'idle', detachable: false }),
    ]);

    expect(restartSummary).toEqual({
      running: 3,
      keepable: 2,
      nonKeepableSessions: [agentSession({ index: 3, status: 'working', detachable: false })],
    });

    const showDialog = vi.fn(() => 0);
    expect(
      resolveQuitAgentSessionsDecision(
        {
          ...restartSummary,
          agentSessions: restartSummary.running,
          terminalSessions: 0,
        },
        showDialog
      )
    ).toEqual({ action: 'quit', mode: 'detach' });
    expect(showDialog).toHaveBeenCalledOnce();
  });

  it('preserves the existing running-only summary for a normal quit', () => {
    const runningSummary = {
      running: 0,
      keepable: 0,
      nonKeepableSessions: [],
    };

    expect(
      resolveAgentSessionSummaryForShutdown(false, runningSummary, [
        agentSession({ index: 1, status: 'idle', detachable: true }),
      ])
    ).toBe(runningSummary);
  });
});

describe('resolveQuitAgentSessionsDecision', () => {
  it('quits without prompting when no agent sessions are running', () => {
    const showDialog = vi.fn();

    expect(
      resolveQuitAgentSessionsDecision(summary({ running: 0, keepable: 0 }), showDialog)
    ).toEqual({
      action: 'quit',
      mode: 'terminate',
    });
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('keeps tmux-backed sessions when the keep button is selected', () => {
    const showDialog = vi.fn(() => 0);

    expect(
      resolveQuitAgentSessionsDecision(summary({ running: 2, keepable: 2 }), showDialog)
    ).toEqual({
      action: 'quit',
      mode: 'detach',
    });
  });

  it('terminates sessions when the stop button is selected', () => {
    const showDialog = vi.fn(() => 1);

    expect(
      resolveQuitAgentSessionsDecision(summary({ running: 2, keepable: 2 }), showDialog)
    ).toEqual({
      action: 'quit',
      mode: 'terminate',
    });
  });

  it('does not offer keep when no sessions are tmux-backed', () => {
    let options: { buttons: string[]; detail: string } | undefined;
    const showDialog = vi.fn((dialogOptions: { buttons: string[]; detail: string }) => {
      options = dialogOptions;
      return 1;
    });

    expect(
      resolveQuitAgentSessionsDecision(
        summary({
          running: 1,
          keepable: 0,
          nonKeepableSessions: [nonKeepableSession('Exit prompt wording')],
        }),
        showDialog
      )
    ).toEqual({
      action: 'cancel',
    });
    expect(options?.buttons).toEqual(['Stop Sessions', 'Cancel']);
    expect(options?.detail).toBe(
      "This session isn't using tmux, so it can't keep running in the background after Yoda quits.\n\n- Exit prompt task - Exit prompt wording (Codex)\n\nStop it to quit, or cancel to keep working."
    );
  });

  it('uses plural wording when multiple non-tmux sessions are running', () => {
    let detail = '';
    const showDialog = vi.fn((options: { detail: string }) => {
      detail = options.detail;
      return 1;
    });

    resolveQuitAgentSessionsDecision(
      summary({
        running: 2,
        keepable: 0,
        nonKeepableSessions: [
          nonKeepableSession('Exit prompt wording', 1),
          nonKeepableSession('Mobile control', 2),
        ],
      }),
      showDialog
    );

    expect(detail).toBe(
      "These sessions aren't using tmux, so they can't keep running in the background after Yoda quits.\n\n- Exit prompt task - Exit prompt wording (Codex)\n- Exit prompt task - Mobile control (Codex)\n\nStop them to quit, or cancel to keep working."
    );
  });

  it('lists direct sessions when only some sessions can be kept', () => {
    let detail = '';
    const showDialog = vi.fn((options: { detail: string }) => {
      detail = options.detail;
      return 2;
    });

    resolveQuitAgentSessionsDecision(
      summary({
        running: 3,
        keepable: 2,
        nonKeepableSessions: [nonKeepableSession('Direct session')],
      }),
      showDialog
    );

    expect(detail).toBe(
      '2 sessions can be kept in tmux. 1 direct session will stop if Yoda quits.\n\n- Exit prompt task - Direct session (Codex)'
    );
  });

  it('includes project terminals in the unified quit prompt', () => {
    let message = '';
    let detail = '';
    const showDialog = vi.fn((options: { message: string; detail: string }) => {
      message = options.message;
      detail = options.detail;
      return 2;
    });

    resolveQuitAgentSessionsDecision(
      summary({
        running: 3,
        keepable: 2,
        agentSessions: 2,
        terminalSessions: 1,
        nonKeepableSessions: [nonKeepableTerminal('Start locally')],
      }),
      showDialog
    );

    expect(message).toBe('2 agent sessions and 1 terminal session are still running.');
    expect(detail).toBe(
      '2 sessions can be kept in tmux. 1 direct session will stop if Yoda quits.\n\n- Start locally (Terminal)'
    );
  });
});
