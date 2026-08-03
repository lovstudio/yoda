import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { runProjectCommand } from './run-project-command';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  getProjectDeliverySummaries: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: { getProjectDeliverySummaries: mocks.getProjectDeliverySummaries },
  },
}));

const project = {
  data: { id: 'project-1', name: 'Example', type: 'local', path: '/repo' },
  taskManager: { tasks: new Map(), createTask: mocks.createTask },
} as unknown as MountedProject;

const action: QuickAction = {
  id: 'review',
  label: 'Review changes',
  command: 'Review the current changes.',
  kind: 'skill',
};

describe('runProjectCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the task before awaiting setup and persists its distillation source', async () => {
    let finishCreate: (() => void) | undefined;
    mocks.createTask.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        })
    );
    const onTaskCreated = vi.fn();

    const result = runProjectCommand({
      project,
      action,
      runtimeId: 'codex',
      defaultBranch: { type: 'local', branch: 'main' },
      quickActionSource: { prompt: action.command, invokedSkill: false },
      onTaskCreated,
    });

    expect(onTaskCreated).toHaveBeenCalledTimes(1);
    const taskId = onTaskCreated.mock.calls[0]?.[0] as string;
    const params = mocks.createTask.mock.calls[0]?.[0] as {
      id: string;
      quickActionSource: { prompt: string; invokedSkill: boolean; conversationId: string };
      initialConversation: { id: string; initialPrompt: string };
    };
    expect(params.id).toBe(taskId);
    expect(mocks.createTask.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ quickActionId: action.id })
    );
    expect(params.quickActionSource).toEqual({
      prompt: action.command,
      invokedSkill: false,
      conversationId: params.initialConversation.id,
    });
    expect(params.initialConversation.initialPrompt).toBe(action.command);
    expect(mocks.getProjectDeliverySummaries).not.toHaveBeenCalled();

    finishCreate?.();
    await expect(result).resolves.toBe(taskId);
  });
});
