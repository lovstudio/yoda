import { describe, expect, it, vi } from 'vitest';
import {
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
