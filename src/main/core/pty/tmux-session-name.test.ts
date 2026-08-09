import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTmuxShellLine,
  decodeTmuxSessionName,
  killTmuxSession,
  killTmuxSessionIfMarkerMatchesStrict,
  killTmuxSessionStrict,
  listTmuxSessionMarkers,
  listTmuxSessionMarkersStrict,
  makeTmuxSessionName,
  TMUX_KILL_TIMEOUT_MS,
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

  it('reuses tmux only when it is bound to the requested agent thread', () => {
    const line = buildTmuxShellLine(
      'agent-session',
      'codex resume current-thread',
      undefined,
      undefined,
      'current-thread'
    );

    expect(line).toContain(
      'tmux -L yoda -f /dev/null show-options -v -t "agent-session" @yoda_agent_session_id'
    );
    expect(line).toContain('[ "$current_identity" = \'current-thread\' ]');
    expect(line).toContain(
      'tmux -L yoda -f /dev/null list-panes -t "agent-session" -F "#{pane_start_command}"'
    );
    expect(line).toContain("grep -F -- 'current-thread'");
    expect(line).toContain('tmux -L yoda -f /dev/null kill-session -t "agent-session"');
    expect(line).toContain(
      'tmux -L yoda -f /dev/null set-option -t "agent-session" @yoda_agent_session_id \'current-thread\''
    );
  });

  it('keeps the legacy attach-or-create path for terminals without an agent identity', () => {
    const line = buildTmuxShellLine('terminal-session', 'exec /bin/zsh -il');

    expect(line).not.toContain('@yoda_agent_session_id');
    expect(line).not.toContain('kill-session');
  });

  it('accepts a provisional identity once and upgrades it to the resolved thread', () => {
    const line = buildTmuxShellLine(
      'agent-session',
      'codex resume resolved-thread',
      undefined,
      undefined,
      'resolved-thread',
      ['conversation-id']
    );

    expect(line).toContain('[ "$current_identity" = \'conversation-id\' ]');
    expect(line).toContain("grep -F -- 'conversation-id'");
    expect(line).toContain("@yoda_agent_session_id 'resolved-thread'");
  });

  it('emits valid POSIX shell syntax for identity-guarded reconnects', () => {
    if (process.platform === 'win32') return;
    const line = buildTmuxShellLine(
      'agent-session',
      'codex resume current-thread',
      { cols: 120, rows: 40 },
      undefined,
      'current-thread'
    );

    const parsed = spawnSync('/bin/sh', ['-n'], { input: line, encoding: 'utf8' });

    expect(parsed.status, parsed.stderr).toBe(0);
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

    expect(ctx.exec).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'yoda', '-f', '/dev/null', 'kill-session', '-t', 'agent-session'],
      { timeout: TMUX_KILL_TIMEOUT_MS }
    );
  });

  it('passes a cleanup-specific timeout through to the underlying execution context', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await killTmuxSession(ctx, 'agent-session', { timeout: 5_000 });

    expect(ctx.exec).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'yoda', '-f', '/dev/null', 'kill-session', '-t', 'agent-session'],
      { timeout: 5_000 }
    );
  });

  it('exposes strict kill failures to reclamation callers', async () => {
    const error = new Error('permission denied');
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockRejectedValue(error),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(killTmuxSessionStrict(ctx, 'agent-session')).rejects.toBe(error);
  });

  it('atomically kills only the unchanged local Yoda tmux instance', async () => {
    const sessionName = makeTmuxSessionName('project:task:conversation');
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(
      killTmuxSessionIfMarkerMatchesStrict(ctx, {
        sessionName,
        cwd: '/repo',
        panePid: 4321,
        createdAtMs: 100_000,
        lastActivityAtMs: 200_000,
        attachedClients: 0,
      })
    ).resolves.toBe('killed');

    expect(ctx.exec).toHaveBeenCalledWith(
      'tmux',
      [
        '-L',
        'yoda',
        '-f',
        '/dev/null',
        'if-shell',
        '-t',
        sessionName,
        '-F',
        expect.stringContaining('#{==:#{pane_pid},4321}'),
        expect.stringContaining('kill-session'),
        expect.stringContaining('__YODA_TMUX_MARKER_MISMATCH__'),
      ],
      { timeout: TMUX_KILL_TIMEOUT_MS }
    );
  });

  it('reports a changed marker as skipped instead of a kill failure', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockResolvedValue({
        stdout: '__YODA_TMUX_MARKER_MISMATCH__\n',
        stderr: '',
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(
      killTmuxSessionIfMarkerMatchesStrict(ctx, {
        sessionName: makeTmuxSessionName('project:task:conversation'),
        cwd: '/repo',
        panePid: 4321,
        createdAtMs: 100_000,
        lastActivityAtMs: 200_000,
        attachedClients: 0,
      })
    ).resolves.toBe('skipped');
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
        stdout: `${sessionName}\\037/repo/worktree\\0374321\\037100\\037200\\0370\n${sessionName}\\037/repo/worktree\\0374321\\037100\\037200\\0370\nforeign\\037/tmp\\03799\\037100\\037200\\0371\n`,
        stderr: '',
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(listTmuxSessionMarkers(ctx)).resolves.toEqual([
      {
        sessionName,
        cwd: '/repo/worktree',
        panePid: 4321,
        createdAtMs: 100_000,
        lastActivityAtMs: 200_000,
        attachedClients: 0,
      },
    ]);
    expect(ctx.exec).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'yoda', '-f', '/dev/null', 'list-panes', '-a', '-F', expect.any(String)],
      { timeout: 2_000, maxBuffer: 128 * 1024 }
    );
  });

  it('treats a missing tmux server as an empty marker set for strict cleanup too', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockRejectedValue(new Error('no server running')),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(listTmuxSessionMarkers(ctx)).resolves.toEqual([]);
    await expect(listTmuxSessionMarkersStrict(ctx)).resolves.toEqual([]);
  });

  it('keeps transport and timeout failures observable to strict cleanup callers', async () => {
    const ctx = {
      root: undefined,
      supportsLocalSpawn: true,
      exec: vi.fn().mockRejectedValue(new Error('operation timed out')),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    };

    await expect(listTmuxSessionMarkers(ctx)).resolves.toEqual([]);
    await expect(listTmuxSessionMarkersStrict(ctx)).rejects.toThrow('operation timed out');
  });
});
