import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  getProjectSessionTaskArchivedAt,
  openProjectSessionConversation,
} from './project-session-open';

const mocks = vi.hoisted(() => ({
  getTaskManagerStore: vi.fn(),
  openTaskTarget: vi.fn(),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: mocks.getTaskManagerStore,
}));

const conversation: Conversation = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtimeId: 'codex',
  title: 'Archived task session',
  lastInteractedAt: '2026-07-05T02:52:10.976Z',
  isInitialConversation: true,
};

describe('project session open target', () => {
  const navigate = vi.fn();
  const restoreTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      tasks: new Map(),
      restoreTask,
    });
  });

  it('opens sessions from active tasks without restoring first', async () => {
    mocks.getTaskManagerStore.mockReturnValue({
      tasks: new Map([['task-1', { data: { id: 'task-1', name: 'Active task' } }]]),
      restoreTask,
    });

    await openProjectSessionConversation(conversation, navigate);

    expect(restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
      navigate
    );
  });

  it('restores an archived task before opening its target session', async () => {
    mocks.getTaskManagerStore.mockReturnValue({
      tasks: new Map([
        [
          'task-1',
          {
            data: {
              id: 'task-1',
              name: 'Archived task',
              archivedAt: '2026-07-05T04:00:00.000Z',
            },
          },
        ],
      ]),
      restoreTask,
    });

    await openProjectSessionConversation(conversation, navigate);

    expect(restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
      navigate
    );
    expect(restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openTaskTarget.mock.invocationCallOrder[0]
    );
  });

  it('exposes archived task state for project-session rows', () => {
    mocks.getTaskManagerStore.mockReturnValue({
      tasks: new Map([
        [
          'task-1',
          {
            data: {
              id: 'task-1',
              name: 'Archived task',
              archivedAt: '2026-07-05T04:00:00.000Z',
            },
          },
        ],
      ]),
      restoreTask,
    });

    expect(getProjectSessionTaskArchivedAt(conversation)).toBe('2026-07-05T04:00:00.000Z');
  });
});
