import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { cleanupDetachedSessions, TASK_SESSION_CLEANUP_CONCURRENCY } from './task-manager';

const mocks = vi.hoisted(() => ({
  getPages: vi.fn(),
  killTmuxSessionStrict: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIdPages: mocks.getPages,
}));

vi.mock('@main/db/client', () => ({
  db: {},
  sqlite: {},
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  makeTmuxSessionName: vi.fn((sessionId: string) => `tmux:${sessionId}`),
  killTmuxSessionStrict: mocks.killTmuxSessionStrict,
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: mocks.warn,
  },
}));

describe('fallback task session cleanup', () => {
  it('reuses a caller-provided marker inventory for project-wide cleanup', async () => {
    vi.clearAllMocks();
    mocks.getPages.mockImplementation(async function* () {
      yield { conversationIds: ['conversation-1'], terminalIds: [] };
    });
    const sessionName = 'tmux:project-1:task-1:conversation-1';

    await cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext, {
      liveTmuxSessionNames: new Set([sessionName]),
    });

    expect(mocks.listTmuxSessionMarkersStrict).not.toHaveBeenCalled();
    expect(mocks.killTmuxSessionStrict).toHaveBeenCalledWith(
      expect.anything(),
      sessionName,
      expect.anything()
    );
  });

  it('kills only existing canonical sessions with bounded concurrency', async () => {
    vi.clearAllMocks();
    mocks.getPages.mockImplementation(async function* () {
      yield {
        conversationIds: Array.from({ length: 13 }, (_, index) => `conversation-${index}`),
        terminalIds: [],
      };
      yield {
        conversationIds: [],
        terminalIds: Array.from({ length: 17 }, (_, index) => `terminal-${index}`),
      };
    });
    const existingLeafIds = [
      ...Array.from({ length: 13 }, (_, index) => `conversation-${index}`),
      ...Array.from({ length: 15 }, (_, index) => `terminal-${index}`),
    ];
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue(
      existingLeafIds.map((leafId) => ({
        sessionName: `tmux:project-1:task-1:${leafId}`,
        cwd: '/repo',
      }))
    );
    let active = 0;
    let maxActive = 0;
    mocks.killTmuxSessionStrict.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });

    await cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext);

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledOnce();
    expect(mocks.killTmuxSessionStrict).toHaveBeenCalledTimes(existingLeafIds.length);
    expect(maxActive).toBe(TASK_SESSION_CLEANUP_CONCURRENCY);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('fails closed when the authoritative tmux listing fails', async () => {
    vi.clearAllMocks();
    mocks.listTmuxSessionMarkersStrict.mockRejectedValue(new Error('list failed'));

    await expect(
      cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext)
    ).rejects.toThrow('list failed');

    expect(mocks.getPages).not.toHaveBeenCalled();
    expect(mocks.killTmuxSessionStrict).not.toHaveBeenCalled();
  });

  it('summarizes strict kill failures and rejects the cleanup', async () => {
    vi.clearAllMocks();
    mocks.getPages.mockImplementation(async function* () {
      yield { conversationIds: ['conversation-1', 'conversation-2'], terminalIds: [] };
    });
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue(
      ['conversation-1', 'conversation-2'].map((leafId) => ({
        sessionName: `tmux:project-1:task-1:${leafId}`,
        cwd: '/repo',
      }))
    );
    mocks.killTmuxSessionStrict.mockImplementation(async (_ctx: unknown, sessionName: string) => {
      if (sessionName.endsWith('conversation-2')) throw new Error('kill failed');
    });

    await expect(
      cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext)
    ).rejects.toThrow('failed to terminate 1 of 2');

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledWith(
      'TaskManager: fallback session cleanup completed with failures',
      expect.objectContaining({ attempted: 2, failed: 1 })
    );
  });

  it('treats a failed kill as an idempotent success when the session exited naturally', async () => {
    vi.clearAllMocks();
    mocks.getPages.mockImplementation(async function* () {
      yield { conversationIds: ['conversation-1'], terminalIds: [] };
    });
    mocks.listTmuxSessionMarkersStrict
      .mockResolvedValueOnce([
        { sessionName: 'tmux:project-1:task-1:conversation-1', cwd: '/repo' },
      ])
      .mockResolvedValueOnce([]);
    mocks.killTmuxSessionStrict.mockRejectedValue(new Error('session not found'));

    await expect(
      cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext)
    ).resolves.toBeUndefined();

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(2);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('fails closed when kill-failure reconciliation cannot list tmux', async () => {
    vi.clearAllMocks();
    mocks.getPages.mockImplementation(async function* () {
      yield { conversationIds: ['conversation-1'], terminalIds: [] };
    });
    mocks.listTmuxSessionMarkersStrict
      .mockResolvedValueOnce([
        { sessionName: 'tmux:project-1:task-1:conversation-1', cwd: '/repo' },
      ])
      .mockRejectedValueOnce(new Error('re-list failed'));
    mocks.killTmuxSessionStrict.mockRejectedValue(new Error('kill failed'));

    await expect(
      cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext)
    ).rejects.toThrow('re-list failed');

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(2);
  });
});
