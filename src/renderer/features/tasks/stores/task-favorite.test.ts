import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { createUnprovisionedTask } from './task';

const mocks = vi.hoisted(() => ({
  setTaskFavorite: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
  rpc: {
    tasks: {
      setTaskFavorite: mocks.setTaskFavorite,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    error: mocks.logError,
  },
}));

describe('TaskStore favorite marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the task optimistically and persists the marker', async () => {
    mocks.setTaskFavorite.mockResolvedValue(undefined);
    const task = createUnprovisionedTask(makeTask());

    await task.setFavorite(true);

    expect(task.data.isFavorite).toBe(true);
    expect(mocks.setTaskFavorite).toHaveBeenCalledWith('task-1', true);
  });

  it('rolls the marker back when persistence fails', async () => {
    mocks.setTaskFavorite.mockRejectedValue(new Error('write failed'));
    const task = createUnprovisionedTask(makeTask());

    await expect(task.setFavorite(true)).rejects.toThrow('write failed');

    expect(task.data.isFavorite).toBe(false);
    expect(mocks.logError).toHaveBeenCalled();
  });
});

function makeTask(): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Retrospective source',
    status: 'done',
    sourceBranch: undefined,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
    statusChangedAt: '2026-08-08T00:00:00.000Z',
    archivedAt: '2026-08-08T01:00:00.000Z',
    isPinned: false,
    isFavorite: false,
    isLongTerm: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
