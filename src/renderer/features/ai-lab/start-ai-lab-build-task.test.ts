import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAiLabBuildTask } from './start-ai-lab-build-task';

const mocks = vi.hoisted(() => ({
  prepareBuildTask: vi.fn(),
  cancelBuildTask: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    aiLab: {
      prepareBuildTask: mocks.prepareBuildTask,
      cancelBuildTask: mocks.cancelBuildTask,
    },
  },
}));

describe('startAiLabBuildTask', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.prepareBuildTask.mockReset();
    mocks.cancelBuildTask.mockReset();
    mocks.createTask.mockReset();
    mocks.prepareBuildTask.mockResolvedValue({ initialPrompt: 'Edit the project directly.' });
    mocks.createTask.mockResolvedValue(undefined);
    mocks.cancelBuildTask.mockResolvedValue(undefined);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  });

  it('creates a normal no-worktree Agent task for the App project', async () => {
    const project = {
      data: { id: 'project-1', baseRef: 'main' },
      taskManager: { createTask: mocks.createTask },
    };

    const launch = await startAiLabBuildTask({
      project: project as never,
      appId: 'app-1',
      prompt: 'Add a weekly view',
      taskName: 'Continue developing App',
      runtimeId: 'amp',
      model: 'amp-model',
    });
    await launch.promise;

    expect(mocks.prepareBuildTask).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-1',
        projectId: 'project-1',
        runtimeId: 'amp',
      })
    );
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        strategy: { kind: 'no-worktree' },
        initialConversation: expect.objectContaining({
          initialPrompt: 'Edit the project directly.',
          runtime: 'amp',
          model: 'amp-model',
        }),
      })
    );
  });

  it('cancels Build tracking when task creation fails', async () => {
    mocks.createTask.mockRejectedValue(new Error('Task failed'));
    const project = {
      data: { id: 'project-1', baseRef: 'main' },
      taskManager: { createTask: mocks.createTask },
    };
    const launch = await startAiLabBuildTask({
      project: project as never,
      prompt: 'Build an app',
      taskName: 'Build',
      runtimeId: 'codex',
    });

    await expect(launch.promise).rejects.toThrow('Task failed');
    expect(mocks.cancelBuildTask).toHaveBeenCalledWith(launch.taskId);
  });
});
