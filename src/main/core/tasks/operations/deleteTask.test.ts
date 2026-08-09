import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskDeletedChannel } from '@shared/events/taskEvents';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  dbDelete: vi.fn(),
  deleteWhere: vi.fn(),
  rendererEvent: vi.fn(),
  getProject: vi.fn(),
  limit: vi.fn(),
  reclaimTaskRuntime: vi.fn(),
  removeTaskWorktree: vi.fn(),
  repositoryDeleteBranch: vi.fn(),
  select: vi.fn(),
  taskEvent: vi.fn(),
  telemetry: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  viewStateDelete: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/tasks/task-runtime-reclamation', () => ({
  reclaimTaskRuntime: mocks.reclaimTaskRuntime,
}));

vi.mock('@main/db/client', () => ({
  db: {
    delete: mocks.dbDelete,
    select: mocks.select,
    update: mocks.update,
  },
}));

vi.mock('@main/core/tasks/task-events', () => ({
  taskEvents: { _emit: mocks.taskEvent },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.rendererEvent },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { del: mocks.viewStateDelete },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.telemetry },
}));

const task = {
  id: 'task-1',
  projectId: 'project-1',
  parentTaskId: null,
  taskBranch: 'yoda/task-1',
};

describe('deleteTask runtime reclamation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: mocks.limit }) }),
    });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.dbDelete.mockReturnValue({ where: mocks.deleteWhere });
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.viewStateDelete.mockResolvedValue(undefined);
    mocks.getProject.mockReturnValue({
      ctx: {},
      removeTaskWorktree: mocks.removeTaskWorktree,
      repository: { deleteBranch: mocks.repositoryDeleteBranch },
    });
    mocks.removeTaskWorktree.mockResolvedValue(undefined);
  });

  it('preserves DB leaves and worktree when runtime cleanup is unconfirmed', async () => {
    mocks.limit.mockResolvedValueOnce([task]);
    mocks.reclaimTaskRuntime.mockResolvedValue({
      confirmed: false,
      failures: [{ stage: 'detached-sessions', error: 'tmux unavailable' }],
    });

    await expect(deleteTask('project-1', 'task-1')).rejects.toThrow(
      'Task runtime cleanup was not confirmed'
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
    expect(mocks.removeTaskWorktree).not.toHaveBeenCalled();
    expect(mocks.repositoryDeleteBranch).not.toHaveBeenCalled();
  });

  it('preserves DB leaves when the project runtime is unavailable', async () => {
    mocks.limit.mockResolvedValueOnce([task]);
    mocks.getProject.mockReturnValue(undefined);

    await expect(deleteTask('project-1', 'task-1')).rejects.toThrow(
      'Project runtime is unavailable'
    );

    expect(mocks.reclaimTaskRuntime).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it('deletes the task and clean worktree but always preserves the branch', async () => {
    mocks.limit.mockResolvedValueOnce([task]).mockResolvedValueOnce([]);
    mocks.reclaimTaskRuntime.mockResolvedValue({ confirmed: true, failures: [] });

    await deleteTask('project-1', 'task-1');

    expect(mocks.reclaimTaskRuntime).toHaveBeenCalledWith('project-1', 'task-1', {});
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.dbDelete).toHaveBeenCalledOnce();
    expect(mocks.removeTaskWorktree).toHaveBeenCalledWith('yoda/task-1');
    expect(mocks.repositoryDeleteBranch).not.toHaveBeenCalled();
    expect(mocks.rendererEvent).toHaveBeenCalledWith(taskDeletedChannel, {
      taskId: 'task-1',
      projectId: 'project-1',
      parentTaskId: undefined,
    });
  });
});
