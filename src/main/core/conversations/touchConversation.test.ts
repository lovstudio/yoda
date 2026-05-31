import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversations, tasks } from '@main/db/schema';
import { touchConversation } from './touchConversation';

const mocks = vi.hoisted(() => ({
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  limitMock: vi.fn(),
  updateMock: vi.fn(),
  setMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.selectMock,
    update: mocks.updateMock,
  },
}));

describe('touchConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.selectMock.mockReturnValue({ from: mocks.fromMock });
    mocks.fromMock.mockReturnValue({ where: mocks.selectWhereMock });
    mocks.selectWhereMock.mockReturnValue({ limit: mocks.limitMock });

    mocks.updateMock.mockReturnValue({ set: mocks.setMock });
    mocks.setMock.mockReturnValue({ where: mocks.updateWhereMock });
    mocks.updateWhereMock.mockResolvedValue(undefined);
  });

  it('persists the prompt timestamp on both conversation and task', async () => {
    const lastInteractedAt = '2026-05-30T10:00:00.000Z';
    mocks.limitMock.mockResolvedValue([{ taskId: 'task-1' }]);

    await touchConversation('conversation-1', lastInteractedAt);

    expect(mocks.updateMock).toHaveBeenNthCalledWith(1, conversations);
    expect(mocks.setMock).toHaveBeenNthCalledWith(1, { lastInteractedAt });
    expect(mocks.updateMock).toHaveBeenNthCalledWith(2, tasks);
    expect(mocks.setMock).toHaveBeenNthCalledWith(2, { lastInteractedAt });
  });

  it('does not write when the conversation is missing', async () => {
    mocks.limitMock.mockResolvedValue([]);

    await touchConversation('missing-conversation', '2026-05-30T10:00:00.000Z');

    expect(mocks.updateMock).not.toHaveBeenCalled();
  });
});
