import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteCodexThread, forkCodexThread, readForkedThreadId } from './codex-thread-fork';

const mocks = vi.hoisted(() => ({
  requestCodexAppServer: vi.fn(),
}));

vi.mock('@main/core/settings/codex-app-server-client', () => ({
  requestCodexAppServer: mocks.requestCodexAppServer,
}));

describe('forkCodexThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestCodexAppServer.mockResolvedValue({ thread: { id: 'forked-thread' } });
  });

  it('forks through the requested completed turn without hydrating all turns', async () => {
    await expect(
      forkCodexThread({ threadId: 'source-thread', lastTurnId: 'turn-2', cwd: '/repo' })
    ).resolves.toBe('forked-thread');

    expect(mocks.requestCodexAppServer).toHaveBeenCalledWith(
      'thread/fork',
      {
        threadId: 'source-thread',
        lastTurnId: 'turn-2',
        cwd: '/repo',
        excludeTurns: true,
      },
      { experimentalApi: true, timeoutMs: 30_000 }
    );
  });

  it('rejects a response that does not identify a distinct fork', async () => {
    mocks.requestCodexAppServer.mockResolvedValueOnce({ thread: {} });
    await expect(
      forkCodexThread({ threadId: 'source-thread', lastTurnId: 'turn-2', cwd: '/repo' })
    ).rejects.toThrow('did not return a thread id');

    mocks.requestCodexAppServer.mockResolvedValueOnce({ thread: { id: 'source-thread' } });
    await expect(
      forkCodexThread({ threadId: 'source-thread', lastTurnId: 'turn-2', cwd: '/repo' })
    ).rejects.toThrow('returned the source thread id');
  });

  it('deletes a known fork during compensation', async () => {
    await deleteCodexThread('forked-thread');

    expect(mocks.requestCodexAppServer).toHaveBeenCalledWith(
      'thread/delete',
      { threadId: 'forked-thread' },
      { experimentalApi: true, timeoutMs: 30_000 }
    );
  });
});

describe('readForkedThreadId', () => {
  it('only accepts a non-empty result.thread.id', () => {
    expect(readForkedThreadId({ thread: { id: ' thread-1 ' } })).toBe('thread-1');
    expect(readForkedThreadId({ thread: { id: '' } })).toBeNull();
    expect(readForkedThreadId(null)).toBeNull();
  });
});
