import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalEnv = { ...process.env };

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

async function loadPtyEnv() {
  vi.resetModules();
  return import('./pty-env');
}

afterEach(() => {
  process.env = { ...originalEnv };
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
  vi.resetModules();
});

describe('pty env Windows shell handling', () => {
  it('does not synthesize /bin/bash as SHELL for Windows terminals', async () => {
    setPlatform('win32');
    delete process.env.SHELL;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const { buildTerminalEnv } = await loadPtyEnv();
    const env = buildTerminalEnv();

    expect(env.SHELL).toBeUndefined();
    // Windows stores env vars with arbitrary casing (typically COMSPEC); Object
    // entries preserve that casing, so accept either form.
    expect(env.ComSpec ?? env.COMSPEC).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('does not synthesize /bin/bash when includeShellVar is true on Windows', async () => {
    setPlatform('win32');
    delete process.env.SHELL;
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';

    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({ includeShellVar: true, agentApiVars: false });

    expect(env.SHELL).toBeUndefined();
    expect(env.ComSpec).toBe('C:\\Windows\\System32\\cmd.exe');
  });

  it('keeps POSIX shell fallback for non-Windows terminal envs', async () => {
    setPlatform('linux');
    delete process.env.SHELL;

    const { buildTerminalEnv } = await loadPtyEnv();
    const env = buildTerminalEnv();

    expect(env.SHELL).toBe('/bin/bash');
  });

  it('adds provider vars while keeping hook variables authoritative', async () => {
    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({
      agentApiVars: false,
      hook: { port: 1234, ptyId: 'claude:conv-1', token: 'real-token' },
      providerVars: {
        ANTHROPIC_BASE_URL: 'https://example.test',
        YODA_HOOK_PORT: '9999',
        YODA_PTY_ID: 'wrong',
        YODA_HOOK_TOKEN: 'wrong-token',
      },
    });

    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.test');
    expect(env.YODA_HOOK_PORT).toBe('1234');
    expect(env.YODA_PTY_ID).toBe('claude:conv-1');
    expect(env.YODA_HOOK_TOKEN).toBe('real-token');
  });

  it('keeps network proxy variables when API env passthrough is disabled', async () => {
    process.env.HTTP_PROXY = 'http://localhost:7890';
    process.env.HTTPS_PROXY = 'http://localhost:7890';
    process.env.NO_PROXY = 'localhost,127.0.0.1';
    process.env.ANTHROPIC_API_KEY = 'secret';

    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({ agentApiVars: false });

    expect(env.HTTP_PROXY).toBe('http://localhost:7890');
    expect(env.HTTPS_PROXY).toBe('http://localhost:7890');
    expect(env.NO_PROXY).toBe('localhost,127.0.0.1');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('keeps network proxy variables when API env passthrough is scoped', async () => {
    process.env.HTTP_PROXY = 'http://localhost:7890';
    process.env.ANTHROPIC_API_KEY = 'secret';
    process.env.OPENAI_API_KEY = 'other-secret';

    const { buildAgentEnv } = await loadPtyEnv();
    const env = buildAgentEnv({ agentApiVars: ['ANTHROPIC_API_KEY'] });

    expect(env.HTTP_PROXY).toBe('http://localhost:7890');
    expect(env.ANTHROPIC_API_KEY).toBe('secret');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
