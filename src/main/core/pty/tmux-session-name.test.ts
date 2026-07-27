import { describe, expect, it, vi } from 'vitest';
import {
  buildTmuxShellLine,
  decodeTmuxSessionName,
  killTmuxSession,
  listTmuxSessionMarkers,
  makeTmuxSessionName,
} from './tmux-session-name';

describe('buildTmuxShellLine', () => {
  it('uses an isolated Yoda tmux server without reading the user tmux config', () => {
    const line = buildTmuxShellLine('agent-session', 'claude --resume abc');

    expect(line).toContain('tmux -L yoda -f /dev/null has-session -t "agent-session"');
    expect(line).toContain('tmux -L yoda -f /dev/null new-session -d -s "agent-session"');
    expect(line).toContain('tmux -L yoda -f /dev/null attach-session -t "agent-session"');
  });

  it('hides tmux status before attaching to Yoda-managed sessions', () => {
    const line = buildTmuxShellLine('agent-session', 'claude --resume abc');

    expect(line).toContain('tmux -L yoda -f /dev/null set-option -t "agent-session" status off');
    expect(
      line.indexOf('tmux -L yoda -f /dev/null set-option -t "agent-session" status off')
    ).toBeLessThan(line.indexOf('tmux -L yoda -f /dev/null attach-session -t "agent-session"'));
  });

  it('enables mouse scroll without showing the copy-mode position indicator', () => {
    const line = buildTmuxShellLine('agent-session', 'claude');

    expect(line).toContain('tmux -L yoda -f /dev/null set-option -t "agent-session" mouse on');
    expect(line).toContain('bind-key -T root WheelUpPane if-shell -F');
    expect(line).toContain('"#{||:#{pane_in_mode},#{mouse_any_flag}}"');
    expect(line).toContain('"send-keys -M" "copy-mode -H -e"');
  });

  it('creates the session at the supplied client size to match xterm width', () => {
    const line = buildTmuxShellLine('agent-session', 'claude', { cols: 140, rows: 40 });

    expect(line).toContain(
      'tmux -L yoda -f /dev/null new-session -d -x 140 -y 40 -s "agent-session"'
    );
    expect(line).toContain('aggressive-resize on');
  });

  it('omits size flags when no size is provided', () => {
    const line = buildTmuxShellLine('agent-session', 'claude');

    expect(line).not.toContain('-x ');
    expect(line).not.toContain('-y ');
  });

  it('exports explicit environment variables inside tmux-created commands', () => {
    const line = buildTmuxShellLine('agent-session', 'claude', undefined, {
      CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
      'INVALID-NAME': 'ignored',
    });

    expect(line).toContain("'export CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN='\\''1'\\''; claude'");
    expect(line).not.toContain('INVALID-NAME');
  });

  it('preserves real newlines in the command line instead of escaping to literal \\n', () => {
    const line = buildTmuxShellLine('agent-session', "claude 'line one\nline two'");

    expect(line).toContain('line one\nline two');
    expect(line).not.toContain('\\n');
  });
});

describe('killTmuxSession', () => {
  it('kills sessions in the isolated Yoda tmux server', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await killTmuxSession(ctx, 'agent-session');

    expect(ctx.exec).toHaveBeenCalledWith('tmux', [
      '-L',
      'yoda',
      '-f',
      '/dev/null',
      'kill-session',
      '-t',
      'agent-session',
    ]);
  });
});

describe('tmux session discovery', () => {
  it('round-trips canonical Yoda session names', () => {
    const sessionId = 'project-1:task-1:conversation:with-colon';
    const sessionName = makeTmuxSessionName(sessionId);

    expect(decodeTmuxSessionName(sessionName)).toBe(sessionId);
    expect(decodeTmuxSessionName('user-owned-session')).toBeUndefined();
    expect(decodeTmuxSessionName('yoda-***')).toBeUndefined();
  });

  it('lists and deduplicates markers from the isolated Yoda server', async () => {
    const sessionName = makeTmuxSessionName('project-1:task-1:conversation-1');
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockResolvedValue({
        stdout: `${sessionName}\\037/repo/worktree\n${sessionName}\\037/repo/worktree\nforeign\\037/tmp\n`,
        stderr: '',
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(listTmuxSessionMarkers(ctx)).resolves.toEqual([
      { sessionName, cwd: '/repo/worktree' },
    ]);
    expect(ctx.exec).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'yoda', '-f', '/dev/null', 'list-panes', '-a', '-F', expect.any(String)],
      { timeout: 2_000, maxBuffer: 128 * 1024 }
    );
  });

  it('treats a missing tmux server as an empty marker set', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockRejectedValue(new Error('no server running')),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(listTmuxSessionMarkers(ctx)).resolves.toEqual([]);
  });
});
