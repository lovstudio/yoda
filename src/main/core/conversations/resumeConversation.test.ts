import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resumeConversation } from './resumeConversation';

const mocks = vi.hoisted(() => ({
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTask.mockReturnValue({
      conversations: {
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
  });

  it('coalesces concurrent resume requests for the same conversation', async () => {
    await Promise.all([
      resumeConversation('project-1', 'task-1', 'conv-1'),
      resumeConversation('project-1', 'task-1', 'conv-1'),
    ]);

    expect(mocks.startSession).toHaveBeenCalledTimes(1);
  });
});
