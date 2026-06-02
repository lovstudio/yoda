import { describe, expect, it } from 'vitest';
import { buildTmuxShellLine } from './tmux-session-name';

describe('buildTmuxShellLine', () => {
  it('hides tmux status before attaching to Yoda-managed sessions', () => {
    const line = buildTmuxShellLine('agent-session', 'claude --resume abc');

    expect(line).toContain('tmux has-session -t "agent-session"');
    expect(line).toContain('tmux new-session -d -s "agent-session"');
    expect(line).toContain('tmux set-option -t "agent-session" status off');
    expect(line).toContain('tmux attach-session -t "agent-session"');
    expect(line.indexOf('tmux set-option -t "agent-session" status off')).toBeLessThan(
      line.indexOf('tmux attach-session -t "agent-session"')
    );
  });
});
