import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTerminalsForTask,
  MAX_PERSISTED_TERMINALS_PER_TASK,
  TerminalRecordOverflowError,
} from './getTerminalsForTask';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  rowsQuery: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

describe('getTerminalsForTask cardinality guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(mocks.rowsQuery);
    mocks.rowsQuery.from.mockReturnThis();
    mocks.rowsQuery.where.mockReturnThis();
  });

  it('returns ordinary terminal rows from one bounded query', async () => {
    const row = {
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
      ssh: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    mocks.rowsQuery.limit.mockResolvedValue([row]);

    await expect(getTerminalsForTask('project-1', 'task-1')).resolves.toEqual([
      expect.objectContaining({ id: row.id, name: row.name }),
    ]);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.rowsQuery.limit).toHaveBeenCalledWith(MAX_PERSISTED_TERMINALS_PER_TASK + 1);
  });

  it('rejects after materializing only the bounded overflow sentinel row', async () => {
    mocks.rowsQuery.limit.mockResolvedValue(
      Array.from({ length: MAX_PERSISTED_TERMINALS_PER_TASK + 1 }, (_, index) => ({
        id: `terminal-${index}`,
      }))
    );

    const error = await getTerminalsForTask('project-1', 'task-1').catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(TerminalRecordOverflowError);
    expect(error).toMatchObject({ count: MAX_PERSISTED_TERMINALS_PER_TASK + 1 });
    expect(String(error)).toContain(`more than ${MAX_PERSISTED_TERMINALS_PER_TASK}`);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.rowsQuery.limit).toHaveBeenCalledWith(MAX_PERSISTED_TERMINALS_PER_TASK + 1);
  });
});
