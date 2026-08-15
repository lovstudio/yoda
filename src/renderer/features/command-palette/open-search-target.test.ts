import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchItem } from '@shared/search';
import { openCommandPaletteSearchTarget } from './open-search-target';

const mocks = vi.hoisted(() => ({
  ensureProjectLoaded: vi.fn(),
  ensureTaskLoaded: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getTaskManagerStore: vi.fn(),
  mountProject: vi.fn(),
  openTaskTarget: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: mocks.getTaskManagerStore,
}));

const archivedConversation: SearchItem = {
  kind: 'conversation',
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  title: 'Archived session',
  subtitle: 'Archived task',
  score: 1,
  taskArchived: true,
};

describe('openCommandPaletteSearchTarget', () => {
  const navigate = vi.fn();

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

  // Archiving is organizational, not a runtime state: an archived target opens
  // like any other, and opening it must never mutate its archive state.
  it('awaits mount and point load before opening an archived conversation', async () => {
    await openCommandPaletteSearchTarget(archivedConversation, navigate);

    expect(mocks.ensureProjectLoaded).toHaveBeenCalledWith('project-1');
    expect(mocks.mountProject).toHaveBeenCalledWith('project-1');
    expect(mocks.ensureTaskLoaded).toHaveBeenCalledWith('task-1');
    expect(mocks.restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      { projectId: 'project-1', taskId: 'task-1', conversationId: 'conversation-1' },
      navigate
    );
    expect(mocks.mountProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureTaskLoaded.mock.invocationCallOrder[0]
    );
    expect(mocks.ensureTaskLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openTaskTarget.mock.invocationCallOrder[0]
    );
  });

  it('surfaces a missing task instead of silently navigating', async () => {
    mocks.ensureTaskLoaded.mockResolvedValue(false);

    await expect(openCommandPaletteSearchTarget(archivedConversation, navigate)).rejects.toThrow(
      'Task task-1 could not be loaded'
    );
    expect(mocks.restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).not.toHaveBeenCalled();
  });

  it('opens without restoring when search metadata disagrees with canonical state', async () => {
    await openCommandPaletteSearchTarget(
      { ...archivedConversation, taskArchived: false },
      navigate
    );

    expect(mocks.restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).toHaveBeenCalledOnce();
  });
});
