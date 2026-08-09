import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTokenUsageTask } from './open-token-usage-task';

const mocks = vi.hoisted(() => ({
  openTaskTarget: vi.fn(),
  prepareExplicitTaskOpen: vi.fn(),
}));

vi.mock('@renderer/app/prepare-explicit-task-open', () => ({
  prepareExplicitTaskOpen: mocks.prepareExplicitTaskOpen,
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

describe('openTokenUsageTask', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepareExplicitTaskOpen.mockResolvedValue(undefined);
  });

  it('opens an active task through the shared task target flow', async () => {
    await openTokenUsageTask(
      { projectId: 'project-1', taskId: 'task-1', archived: false },
      navigate
    );

    expect(mocks.prepareExplicitTaskOpen).toHaveBeenCalledWith('project-1', 'task-1');
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

    expect(mocks.prepareExplicitTaskOpen).toHaveBeenCalledWith('project-1', 'task-1');
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1' },
      navigate
    );
    expect(mocks.prepareExplicitTaskOpen.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openTaskTarget.mock.invocationCallOrder[0]
    );
  });
});
