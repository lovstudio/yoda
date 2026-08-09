import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import {
  openProjectSessionConversation,
  prepareProjectSessionConversation,
} from './project-session-open';

const mocks = vi.hoisted(() => ({
  asProvisioned: vi.fn(),
  ensureTaskLoaded: vi.fn(),
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
const activeTarget = { ...conversation, taskArchivedAt: null };
const archivedTarget = {
  ...conversation,
  taskArchivedAt: '2026-07-05T04:00:00.000Z',
};

describe('project session open target', () => {
  const navigate = vi.fn();
  const restoreTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTask.mockResolvedValue(undefined);
    mocks.ensureTaskLoaded.mockResolvedValue(true);
    mocks.prepareTaskTarget.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      restoreTask,
      tasks: new Map([['task-1', { state: 'unprovisioned', data: { id: 'task-1' } }]]),
    });
  });

  it('opens sessions from active tasks without restoring first', async () => {
    await openProjectSessionConversation(activeTarget, navigate);

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
    mockCanonicalTaskArchived();
    await openProjectSessionConversation(archivedTarget, navigate);

    expect(mocks.prepareTaskTarget).toHaveBeenCalledWith('project-1');
    expect(mocks.ensureTaskLoaded).toHaveBeenCalledWith('task-1');
    expect(restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.openTaskTarget).toHaveBeenCalledWith(
      {
        projectId: 'project-1',
        taskId: 'task-1',
        conversationId: 'conversation-1',
      },
      navigate
    );
    expect(mocks.ensureTaskLoaded.mock.invocationCallOrder[0]).toBeLessThan(
      restoreTask.mock.invocationCallOrder[0]
    );
    expect(restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openTaskTarget.mock.invocationCallOrder[0]
    );
  });

  it('fails closed when archived task metadata cannot be point-loaded', async () => {
    mocks.ensureTaskLoaded.mockResolvedValue(false);

    await expect(openProjectSessionConversation(archivedTarget, navigate)).rejects.toThrow(
      'Task task-1 could not be loaded'
    );
    expect(restoreTask).not.toHaveBeenCalled();
    expect(mocks.openTaskTarget).not.toHaveBeenCalled();
  });

  it('uses canonical task state when session metadata is stale', async () => {
    mockCanonicalTaskArchived();

    await openProjectSessionConversation(activeTarget, navigate);

    expect(restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.openTaskTarget).toHaveBeenCalledOnce();
  });

  it('forwards a prompt checkpoint when opening its session', async () => {
    await openProjectSessionConversation(activeTarget, navigate, {
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
    mockCanonicalTaskArchived();
    const taskStore = { data: { id: 'task-1' } };
    const provisioned = { projectId: 'project-1', taskId: 'task-1' };
    mocks.getTaskStore.mockReturnValue(taskStore);
    mocks.asProvisioned.mockReturnValue(provisioned);

    await expect(prepareProjectSessionConversation(archivedTarget)).resolves.toBe(provisioned);

    expect(mocks.ensureTaskLoaded).toHaveBeenCalledWith('task-1');
    expect(restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.prepareTaskTarget).toHaveBeenCalledWith('project-1', 'task-1');
    expect(restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prepareTaskTarget.mock.invocationCallOrder[1]
    );
  });

  function mockCanonicalTaskArchived(): void {
    mocks.getTaskManagerStore.mockReturnValue({
      ensureTaskLoaded: mocks.ensureTaskLoaded,
      restoreTask,
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
  }
});
