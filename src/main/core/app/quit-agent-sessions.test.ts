import { describe, expect, it, vi } from 'vitest';
import { resolveQuitAgentSessionsDecision } from './quit-agent-sessions';

describe('resolveQuitAgentSessionsDecision', () => {
  it('quits without prompting when no agent sessions are running', () => {
    const showDialog = vi.fn();

    expect(resolveQuitAgentSessionsDecision({ running: 0, keepable: 0 }, showDialog)).toEqual({
      action: 'quit',
      mode: 'terminate',
    });
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('keeps tmux-backed sessions when the keep button is selected', () => {
    const showDialog = vi.fn(() => 0);

    expect(resolveQuitAgentSessionsDecision({ running: 2, keepable: 2 }, showDialog)).toEqual({
      action: 'quit',
      mode: 'detach',
    });
  });

  it('terminates sessions when the stop button is selected', () => {
    const showDialog = vi.fn(() => 1);

    expect(resolveQuitAgentSessionsDecision({ running: 2, keepable: 2 }, showDialog)).toEqual({
      action: 'quit',
      mode: 'terminate',
    });
  });

  it('does not offer keep when no sessions are tmux-backed', () => {
    let buttons: string[] = [];
    const showDialog = vi.fn((options: { buttons: string[] }) => {
      buttons = options.buttons;
      return 1;
    });

    expect(resolveQuitAgentSessionsDecision({ running: 1, keepable: 0 }, showDialog)).toEqual({
      action: 'cancel',
    });
    expect(buttons).toEqual(['Stop Sessions', 'Cancel']);
  });
});
