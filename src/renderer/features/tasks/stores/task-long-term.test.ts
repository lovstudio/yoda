import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/tasks';
import { createUnprovisionedTask } from './task';

const mocks = vi.hoisted(() => ({
  setTaskLongTerm: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
  rpc: {
    tasks: {
      setTaskLongTerm: mocks.setTaskLongTerm,
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

describe('TaskStore long-term marker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the task optimistically and persists the marker', async () => {
    mocks.setTaskLongTerm.mockResolvedValue(undefined);
    const task = createUnprovisionedTask(makeTask());

    await task.setLongTerm(true);

    expect(task.data.isLongTerm).toBe(true);
    expect(mocks.setTaskLongTerm).toHaveBeenCalledWith('task-1', true);
  });

  it('rolls the marker back when persistence fails', async () => {
    mocks.setTaskLongTerm.mockRejectedValue(new Error('write failed'));
    const task = createUnprovisionedTask(makeTask());

    await expect(task.setLongTerm(true)).rejects.toThrow('write failed');

    expect(task.data.isLongTerm).toBe(false);
    expect(mocks.logError).toHaveBeenCalled();
  });
});

function makeTask(): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Long-running research',
    status: 'in_progress',
    sourceBranch: undefined,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    statusChangedAt: '2026-07-31T00:00:00.000Z',
    isPinned: false,
    isLongTerm: false,
    needsReview: false,
    isUserNamed: false,
    setupStatus: 'ready',
    prs: [],
    conversations: {},
  };
}
