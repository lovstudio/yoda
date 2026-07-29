import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  getProjectSessionTaskArchivedAt,
  openProjectSessionConversation,
  prepareProjectSessionConversation,
} from './project-session-open';

const mocks = vi.hoisted(() => ({
  asProvisioned: vi.fn(),
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  openTaskTarget: vi.fn(),
  prepareTaskTarget: vi.fn(),
}));

vi.mock('@renderer/app/open-task-target', () => ({
  openTaskTarget: mocks.openTaskTarget,
  prepareTaskTarget: mocks.prepareTaskTarget,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: mocks.asProvisioned,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
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

  it('forwards a prompt checkpoint when opening its session', async () => {
    await openProjectSessionConversation(conversation, navigate, {
      id: 'prompt-3',
      index: 2,
    });

    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
        promptId: 'prompt-3',
        promptIndex: 2,
      },
      navigate
    );
  });

  it('restores and provisions the task before a project-level prompt fork', async () => {
    const taskStore = { data: { id: 'task-1' } };
    const provisioned = { projectId: 'project-1', taskId: 'task-1' };
    mocks.getTaskManagerStore.mockReturnValue({
      tasks: new Map([
        [
          'task-1',
          {
            data: {
              id: 'task-1',
              archivedAt: '2026-07-05T04:00:00.000Z',
            },
          },
        ],
      ]),
      restoreTask,
    });
    mocks.getTaskStore.mockReturnValue(taskStore);
    mocks.asProvisioned.mockReturnValue(provisioned);

    await expect(prepareProjectSessionConversation(conversation)).resolves.toBe(provisioned);

    expect(restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.prepareTaskTarget).toHaveBeenCalledWith('project-1', 'task-1');
    expect(restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareTaskTarget.mock.invocationCallOrder[0]
    );
  });
});
