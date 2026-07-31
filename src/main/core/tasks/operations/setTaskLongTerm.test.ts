import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTaskLongTerm } from './setTaskLongTerm';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  selectWhere: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.select,
    update: mocks.update,
  },
}));

describe('setTaskLongTerm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.selectWhere });
    mocks.selectWhere.mockReturnValue({ limit: mocks.limit });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('persists the long-term marker', async () => {
    mocks.limit.mockResolvedValue([{ id: 'task-1' }]);

    await setTaskLongTerm('task-1', true);

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isLongTerm: 1,
      })
    );
  });

  it('rejects unknown tasks without issuing an update', async () => {
    mocks.limit.mockResolvedValue([]);

    await expect(setTaskLongTerm('missing-task', true)).rejects.toThrow(
      'Task not found: missing-task'
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
