import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTaskFacet } from './setTaskFacet';

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

describe('setTaskFacet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.selectWhere });
    mocks.selectWhere.mockReturnValue({ limit: mocks.limit });
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('persists the facet membership', async () => {
    mocks.limit.mockResolvedValue([{ id: 'task-1' }]);

    await setTaskFacet('task-1', 'facet-mobile');

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        facetId: 'facet-mobile',
      })
    );
  });

  it('clears the membership with null', async () => {
    mocks.limit.mockResolvedValue([{ id: 'task-1' }]);

    await setTaskFacet('task-1', null);

    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({
        facetId: null,
      })
    );
  });

  it('rejects unknown tasks without issuing an update', async () => {
    mocks.limit.mockResolvedValue([]);

    await expect(setTaskFacet('missing-task', 'facet-mobile')).rejects.toThrow(
      'Task not found: missing-task'
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
