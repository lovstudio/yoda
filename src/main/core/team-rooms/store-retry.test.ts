import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retryFailedHandoff } from './store';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  selectWhere: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  messageSet: vi.fn(),
  messageWhere: vi.fn(),
  returning: vi.fn(),
  roomSet: vi.fn(),
  roomWhere: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select, update: mocks.update },
}));

vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));
vi.mock('./team-room-events', () => ({ teamRoomEvents: { _emit: vi.fn() } }));

const failedRow = {
  id: 'handoff-1',
  roomId: 'room-1',
  authorMemberId: 'planner-1',
  kind: 'handoff',
  body: 'Implement the completed plan.',
  mentions: '["implementer"]',
  sessionRef: 'planner-session',
  verdict: null,
  visibility: 'room',
  deliveryStatus: 'failed',
  deliveryError: 'Task not found',
  createdAt: '2026-08-08T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.selectWhere });
  mocks.selectWhere.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.orderBy.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([failedRow]);

  mocks.update
    .mockReturnValueOnce({ set: mocks.messageSet })
    .mockReturnValueOnce({ set: mocks.roomSet });
  mocks.messageSet.mockReturnValue({ where: mocks.messageWhere });
  mocks.messageWhere.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockImplementation(async () => [
    {
      ...failedRow,
      deliveryStatus: 'pending',
      deliveryError: null,
      createdAt: '2026-08-08T11:00:00.000Z',
    },
  ]);
  mocks.roomSet.mockReturnValue({ where: mocks.roomWhere });
  mocks.roomWhere.mockResolvedValue(undefined);
});

describe('retryFailedHandoff', () => {
  it('resets and reuses the matching failed hand-off instead of inserting another message', async () => {
    const result = await retryFailedHandoff({
      roomId: 'room-1',
      authorMemberId: 'planner-1',
      body: 'Implement the completed plan.',
      mentions: ['implementer'],
      sessionRef: 'planner-session',
      visibility: 'room',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        deliveryStatus: 'pending',
        deliveryError: null,
      })
    );
    expect(mocks.messageSet).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryStatus: 'pending', deliveryError: null })
    );
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledOnce();
  });

  it('leaves message creation to the caller when no failed hand-off matches', async () => {
    mocks.limit.mockResolvedValue([]);

    await expect(
      retryFailedHandoff({
        roomId: 'room-1',
        authorMemberId: 'planner-1',
        body: 'A new assignment.',
        mentions: ['implementer'],
        sessionRef: 'planner-session',
        visibility: 'room',
      })
    ).resolves.toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
