import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { cleanupDetachedSessions, TASK_SESSION_CLEANUP_CONCURRENCY } from './task-manager';

const mocks = vi.hoisted(() => ({
  getPages: vi.fn(),
  killTmuxSession: vi.fn(),
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
  killTmuxSession: mocks.killTmuxSession,
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
  it('consumes every page with bounded concurrency and summarizes failures', async () => {
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
    let active = 0;
    let maxActive = 0;
    mocks.killTmuxSession.mockImplementation(async (_ctx: unknown, sessionName: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (sessionName.endsWith(':terminal-3')) throw new Error('kill failed');
    });

    await cleanupDetachedSessions('project-1', 'task-1', {} as IExecutionContext);

    expect(mocks.killTmuxSession).toHaveBeenCalledTimes(30);
    expect(maxActive).toBe(TASK_SESSION_CLEANUP_CONCURRENCY);
    expect(mocks.warn).toHaveBeenCalledWith(
      'TaskManager: fallback session cleanup completed with failures',
      expect.objectContaining({ attempted: 30, failed: 1 })
    );
  });
});
