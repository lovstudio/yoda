import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveConversationToTask } from './move-conversation-to-task';

const mocks = vi.hoisted(() => ({
  moveConversation: vi.fn(),
  toast: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@renderer/lib/i18n', () => ({
  default: {
    t: (key: string, values?: { task?: string }) => (values?.task ? `${key}:${values.task}` : key),
  },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { conversations: { moveConversation: mocks.moveConversation } },
}));
vi.mock('@renderer/utils/logger', () => ({ log: { warn: mocks.warn } }));

const input = {
  projectId: 'project-1',
  sourceTaskId: 'task-1',
  targetTaskId: 'task-2',
  targetTaskName: 'Target task',
  conversationId: 'conversation-1',
};

describe('moveConversationToTask', () => {
  beforeEach(() => {
    mocks.moveConversation.mockReset();
    mocks.toast.mockReset();
    mocks.warn.mockReset();
  });

  it('uses the shared RPC and reports the selected target', async () => {
    mocks.moveConversation.mockResolvedValue(undefined);

    await expect(moveConversationToTask(input)).resolves.toBe(true);

    expect(mocks.moveConversation).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'task-2',
      'conversation-1'
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.conversations.moveSuccess:Target task',
    });
  });

  it('keeps failures inside the shared action and shows the backend message', async () => {
    const error = new Error('Target task is unavailable');
    mocks.moveConversation.mockRejectedValue(error);

    await expect(moveConversationToTask(input)).resolves.toBe(false);

    expect(mocks.warn).toHaveBeenCalledWith(
      'moveConversationToTask: failed to move conversation',
      expect.objectContaining({ error, targetTaskId: 'task-2' })
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'tasks.conversations.moveFailed',
      description: 'Target task is unavailable',
      variant: 'destructive',
    });
  });
});
