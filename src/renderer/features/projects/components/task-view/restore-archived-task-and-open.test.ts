import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreArchivedTaskAndOpen } from './restore-archived-task-and-open';

const mocks = vi.hoisted(() => ({
  getTaskManagerStore: vi.fn(),
  getTaskStore: vi.fn(),
  openPreferredConversation: vi.fn(),
  provisionTask: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: (store: unknown) => store,
  getTaskManagerStore: mocks.getTaskManagerStore,
  getTaskStore: mocks.getTaskStore,
}));

describe('restoreArchivedTaskAndOpen', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restoreTask.mockResolvedValue(undefined);
    mocks.provisionTask.mockResolvedValue(undefined);
    mocks.getTaskManagerStore.mockReturnValue({
      restoreTask: mocks.restoreTask,
      provisionTask: mocks.provisionTask,
    });
    mocks.getTaskStore.mockReturnValue({
      taskView: {
        tabManager: {
          openPreferredConversation: mocks.openPreferredConversation,
        },
      },
    });
  });

  it('restores and provisions an archived task before entering its preferred conversation', async () => {
    await restoreArchivedTaskAndOpen('project-1', 'task-1', navigate);

    expect(mocks.restoreTask).toHaveBeenCalledWith('task-1');
    expect(mocks.provisionTask).toHaveBeenCalledWith('task-1');
    expect(mocks.openPreferredConversation).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('task', {
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(mocks.restoreTask.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.provisionTask.mock.invocationCallOrder[0]
    );
    expect(mocks.provisionTask.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );
  });
});
