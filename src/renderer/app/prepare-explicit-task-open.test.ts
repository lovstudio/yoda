import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareExplicitTaskOpen } from './prepare-explicit-task-open';

const mocks = vi.hoisted(() => ({
  ensureProjectLoaded: vi.fn(),
  ensureTaskLoaded: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getTaskManagerStore: vi.fn(),
  mountProject: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: mocks.getTaskManagerStore,
}));

describe('prepareExplicitTaskOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureProjectLoaded.mockResolvedValue(true);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.ensureTaskLoaded.mockResolvedValue(true);
    mocks.restoreTask.mockResolvedValue(undefined);
    mocks.getProjectManagerStore.mockReturnValue({
      ensureProjectLoaded: mocks.ensureProjectLoaded,
      mountProject: mocks.mountProject,
    });
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      restoreTask: mocks.restoreTask,
      tasks: new Map([
        [
          'task-1',
          {
            state: 'unprovisioned',
            data: { id: 'task-1', archivedAt: '2026-07-05T04:00:00.000Z' },
          },
        ],
      ]),
    });
  });

  it('awaits mount, point load, and canonical restore in order', async () => {
    await prepareExplicitTaskOpen('project-1', 'task-1');

    expect(mocks.mountProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureTaskLoaded.mock.invocationCallOrder[0]
    );
    expect(mocks.ensureTaskLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.restoreTask.mock.invocationCallOrder[0]
    );
  });

  it('does not trust stale archived metadata when the canonical task is active', async () => {
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      restoreTask: mocks.restoreTask,
      tasks: new Map([['task-1', { state: 'unprovisioned', data: { id: 'task-1' } }]]),
    });

    await prepareExplicitTaskOpen('project-1', 'task-1');

    expect(mocks.restoreTask).not.toHaveBeenCalled();
  });

  it('fails closed when the task cannot be point-loaded', async () => {
    mocks.ensureTaskLoaded.mockResolvedValue(false);

    await expect(prepareExplicitTaskOpen('project-1', 'task-1')).rejects.toThrow(
      'Task task-1 could not be loaded'
    );
    expect(mocks.restoreTask).not.toHaveBeenCalled();
  });
});
