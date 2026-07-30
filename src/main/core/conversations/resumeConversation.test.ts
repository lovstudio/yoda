import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resumeConversation } from './resumeConversation';

const mocks = vi.hoisted(() => ({
  getActiveSessions: vi.fn(),
  startSession: vi.fn(),
  resolveTask: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
  },
}));

vi.mock('@main/db/schema', () => ({
  conversations: {},
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./utils', () => ({
  mapConversationRowToConversation: vi.fn((row: unknown) => row),
}));

describe('resumeConversation', () => {
  const sessionId = makePtySessionId('project-1', 'task-1', 'conv-1');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTask.mockReturnValue({
      conversations: {
        getActiveSessions: mocks.getActiveSessions,
        startSession: mocks.startSession,
      },
    });
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ]);
    mocks.startSession.mockResolvedValue(undefined);
    mocks.getActiveSessions.mockReturnValue([{ conversationId: 'conv-1' }]);
  });

  afterEach(() => {
    ptySessionRegistry.unregister(sessionId);
  });

  it('coalesces concurrent resume requests for the same conversation', async () => {
    await expect(
      Promise.all([
        resumeConversation('project-1', 'task-1', 'conv-1'),
        resumeConversation('project-1', 'task-1', 'conv-1'),
      ])
    ).resolves.toEqual([true, true]);

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
  });

  it('reports when startup completes without a live provider session', async () => {
    mocks.getActiveSessions.mockReturnValue([]);

    await expect(resumeConversation('project-1', 'task-1', 'conv-1')).resolves.toBe(false);
  });

  it('does not restart after stop cancels registration during the database lookup', async () => {
    let finishLookup!: (rows: unknown[]) => void;
    mocks.selectChain.limit.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLookup = resolve;
      })
    );

    const resumePromise = resumeConversation('project-1', 'task-1', 'conv-1');
    ptySessionRegistry.unregister(sessionId);
    finishLookup([
      {
        id: 'conv-1',
        projectId: 'project-1',
        taskId: 'task-1',
      },
    ]);
    await expect(resumePromise).resolves.toBe(false);

    expect(mocks.startSession).not.toHaveBeenCalled();
  });
});
