import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTokenUsageTask } from './open-token-usage-task';

const mocks = vi.hoisted(() => ({
  getTaskManagerStore: vi.fn(),
  openTaskTarget: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: mocks.getTaskManagerStore,
}));

describe('openTokenUsageTask', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restoreTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      restoreTask: mocks.restoreTask,
    });
  });

  it('opens an active task through the shared task target flow', async () => {
    await openTokenUsageTask(
      { projectId: 'project-1', taskId: 'task-1', archived: false },
      navigate
    );

    expect(mocks.restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1' },
      navigate
    );
  });

  it('restores an archived task before opening it', async () => {
    await openTokenUsageTask(
      { projectId: 'project-1', taskId: 'task-1', archived: true },
      navigate
    );

    expect(mocks.restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1' },
      navigate
    );
    expect(mocks.restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openTaskTarget.mock.invocationCallOrder[0]
    );
  });
});
