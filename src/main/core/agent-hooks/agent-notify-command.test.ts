import { describe, expect, it, vi } from 'vitest';
import {
  makeClaudeHookCommand,
  makeCodexNotifyCommand,
  makeOpenCodePluginContent,
} from './agent-notify-command';

describe('makeCodexNotifyCommand', () => {
  it('writes the Windows notify script only once per script path', () => {
    const writeFile = vi.fn();
    const mkdir = vi.fn();
    const scriptPath = 'C:\\Temp\\yoda-codex-notify.ps1';

    makeCodexNotifyCommand({ platform: 'win32', scriptPath, mkdir, writeFile });
    makeCodexNotifyCommand({ platform: 'win32', scriptPath, mkdir, writeFile });

    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});

describe('makeClaudeHookCommand', () => {
  it('reads the live hook endpoint file instead of a captured env port', () => {
    const cmd = makeClaudeHookCommand('stop');
    // Resolves port/token from the endpoint file at fire-time...
    expect(cmd).toContain('hook-endpoint.json');
    expect(cmd).toContain('$YH_PORT');
    expect(cmd).toContain('$YH_TOKEN');
    // ...but PTY id stays from env (stable per PTY across restarts).
    expect(cmd).toContain('$YODA_PTY_ID');
    expect(cmd).toContain('X-Yoda-Event-Type: stop');
    // No longer relies on the stale spawn-time port env.
    expect(cmd).not.toContain('YODA_HOOK_PORT');
    // Must NOT wrap itself in `sh -c '...'` — CC runs the command string in a
    // shell already, and a wrapper collides with the inner sed single-quotes.
    expect(cmd).not.toContain("sh -c '");
    // Uses sed (no python) so there is no nested-quote hazard.
    expect(cmd).toContain('sed -n');
    expect(cmd).not.toContain('python3');
  });
});

describe('makeCodexNotifyCommand (posix)', () => {
  it('reads the live hook endpoint file at fire-time', () => {
    const argv = makeCodexNotifyCommand({ platform: 'darwin' });
    const script = argv.join(' ');
    expect(script).toContain('hook-endpoint.json');
    expect(script).toContain('$YH_PORT');
    expect(script).not.toContain('YODA_HOOK_PORT');
  });
});

describe('makeOpenCodePluginContent', () => {
  it('posts OpenCode session events to the Yoda hook server', () => {
    const content = makeOpenCodePluginContent();

    expect(content).toContain('hook-endpoint.json');
    expect(content).toContain("event.type === 'session.idle'");
    expect(content).toContain("event.type === 'session.error'");
    expect(content).toContain("'X-Yoda-Event-Type': payload.type");
  });
});
