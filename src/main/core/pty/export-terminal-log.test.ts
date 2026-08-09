import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportTerminalLog, terminalLogFileName } from './export-terminal-log';

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getDiagnostics: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}));

vi.mock('./pty-session-registry', () => ({
  ptySessionRegistry: {
    getDiagnostics: mocks.getDiagnostics,
    snapshot: mocks.snapshot,
  },
}));

describe('exportTerminalLog', () => {
  let userDataPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    userDataPath = await mkdtemp(join(tmpdir(), 'yoda-terminal-log-'));
    mocks.getPath.mockReturnValue(userDataPath);
    mocks.getDiagnostics.mockReturnValue({
      sessionId: 'project:task:terminal',
      live: true,
      outputBytesPerSecond: 0,
      lastOutputAt: null,
      lastInputAt: null,
      ringBufferBytes: 32,
      ringBufferCapBytes: 1024,
      consumerCount: 1,
      pendingOutputBytes: 0,
    });
    mocks.snapshot.mockReturnValue('\x1b[31mfailed\x1b[0m\r\nnext line');
  });

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true });
  });

  it('writes a readable snapshot to a stable local log path', async () => {
    const result = await exportTerminalLog('project:task:terminal');

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.path).toBe(
      join(userDataPath, 'logs', 'terminals', terminalLogFileName('project:task:terminal'))
    );
    expect(result.data.content).toBe('failed\nnext line');
    expect(await readFile(result.data.path, 'utf8')).toBe(result.data.content);
    expect(result.data.contentBytes).toBe(Buffer.byteLength(result.data.content, 'utf8'));
  });

  it('does not create a misleading log for an unknown session', async () => {
    mocks.getDiagnostics.mockReturnValue(null);

    await expect(exportTerminalLog('missing')).resolves.toEqual({
      success: false,
      error: { type: 'not_found' },
    });
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
