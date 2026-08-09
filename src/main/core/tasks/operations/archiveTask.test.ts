import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveTask } from './archiveTask';

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  getDescendantTaskIds: vi.fn(),
  getProject: vi.fn(),
  reclaimTaskRuntime: vi.fn(),
  removeTaskWorktree: vi.fn(),
  snapshotTaskDiffTotals: vi.fn(),
  taskEvent: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.dbSelect,
    update: mocks.dbUpdate,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/tasks/task-runtime-reclamation', () => ({
  reclaimTaskRuntime: mocks.reclaimTaskRuntime,
}));

vi.mock('@main/core/stats/task-diff-snapshot', () => ({
  snapshotTaskDiffTotals: mocks.snapshotTaskDiffTotals,
}));

vi.mock('@main/core/tasks/task-events', () => ({
  taskEvents: { _emit: mocks.taskEvent, on: vi.fn() },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

vi.mock('./task-hierarchy', () => ({
  getDescendantTaskIds: mocks.getDescendantTaskIds,
}));

const task = {
  id: 'task-1',
  projectId: 'project-1',
  taskBranch: 'yoda/task-1',
  archiveNote: null,
};

function setupSelects(): void {
  mocks.dbSelect
    .mockImplementationOnce(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => [{ task, projectPath: '/repo' }] }),
        }),
      }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({ where: async () => [] }),
    }))
    .mockImplementationOnce(() => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }));
}

describe('archiveTask runtime reclamation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbSelect.mockReset();
    mocks.getDescendantTaskIds.mockResolvedValue([]);
    setupSelects();
    mocks.dbUpdate.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.snapshotTaskDiffTotals.mockResolvedValue(undefined);
    mocks.getProject.mockReturnValue({
      ctx: {},
      removeTaskWorktree: mocks.removeTaskWorktree,
    });
    mocks.removeTaskWorktree.mockResolvedValue(undefined);
  });

  it('awaits runtime reclamation before archiving the task or removing its worktree', async () => {
    let finishCleanup: ((value: { confirmed: true; failures: [] }) => void) | undefined;
    mocks.reclaimTaskRuntime.mockReturnValue(
      new Promise((resolve) => {
        finishCleanup = resolve;
      })
    );

    const archive = archiveTask('project-1', 'task-1', undefined, { skipPreCommand: true });
    await vi.waitFor(() => expect(mocks.reclaimTaskRuntime).toHaveBeenCalledOnce());

    expect(mocks.updateSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'archived' })
    );
    expect(mocks.removeTaskWorktree).not.toHaveBeenCalled();

    finishCleanup?.({ confirmed: true, failures: [] });
    await archive;

    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
    expect(mocks.removeTaskWorktree).toHaveBeenCalledWith('yoda/task-1');
  });

  it('archives but preserves the worktree when runtime reclamation is unconfirmed', async () => {
    mocks.reclaimTaskRuntime.mockResolvedValue({
      confirmed: false,
      failures: [{ stage: 'teardown', error: 'workspace busy' }],
    });

    const result = await archiveTask('project-1', 'task-1', undefined, {
      skipPreCommand: true,
    });

    expect(result).toEqual({ archivedTaskIds: ['task-1'] });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
    expect(mocks.removeTaskWorktree).not.toHaveBeenCalled();
  });
});
