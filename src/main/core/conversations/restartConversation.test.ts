import { beforeEach, describe, expect, it, vi } from 'vitest';
import { restartConversation } from './restartConversation';

const mocks = vi.hoisted(() => ({
  clearPendingInitialPrompt: vi.fn(),
  reconcileConversationPermission: vi.fn(),
  resolveTask: vi.fn(),
  startSession: vi.fn(),
  stabilizePendingInitialPromptDelivery: vi.fn(),
  stopSession: vi.fn(),
  selectChain: {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => mocks.selectChain),
  },
}));

vi.mock('@main/db/schema', () => ({ conversations: {} }));

vi.mock('@main/core/skills/SkillsService', () => ({
  skillsService: { resolveSessionPolicy: vi.fn() },
}));

vi.mock('../projects/utils', () => ({ resolveTask: mocks.resolveTask }));

vi.mock('./pending-initial-prompt-store', () => ({
  clearPendingInitialPrompt: mocks.clearPendingInitialPrompt,
  stabilizePendingInitialPromptDelivery: mocks.stabilizePendingInitialPromptDelivery,
}));

vi.mock('./reconcile-conversation-permission', () => ({
  reconcileConversationPermission: mocks.reconcileConversationPermission,
}));

vi.mock('./utils', () => ({
  mapConversationRowToConversation: vi.fn((row: unknown) => row),
}));

describe('restartConversation', () => {
  const pendingConversation = {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex' as const,
    title: 'Recover me',
    lastInteractedAt: null,
    isInitialConversation: true,
    pendingInitialPrompt: {
      prompt: 'Restore the original task',
      imagePaths: ['/tmp/context.png'],
      model: 'gpt-5.6-sol',
      reasoningEffort: 'ultra',
    },
    config: '{}',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectChain.from.mockReturnThis();
    mocks.selectChain.where.mockReturnThis();
    mocks.selectChain.limit.mockResolvedValue([pendingConversation]);
    mocks.reconcileConversationPermission.mockImplementation(async (conversation) => conversation);
    mocks.startSession.mockResolvedValue(undefined);
    mocks.stabilizePendingInitialPromptDelivery.mockResolvedValue({ config: '{}' });
    mocks.stopSession.mockResolvedValue(undefined);
    mocks.clearPendingInitialPrompt.mockResolvedValue(undefined);
  });

  it('replays a pending local Codex prompt as fresh and waits for native binding', async () => {
    mocks.resolveTask.mockReturnValue({
      conversations: {
        startSession: mocks.startSession,
        stopSession: mocks.stopSession,
        waitsForInitialPromptSessionBinding: (runtimeId: string) => runtimeId === 'codex',
      },
    });

    await restartConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.stopSession).toHaveBeenCalledWith('conversation-1');
    expect(mocks.stopSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stabilizePendingInitialPromptDelivery.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.startSession).toHaveBeenCalledWith(
      pendingConversation,
      undefined,
      false,
      'Restore the original task',
      undefined,
      ['/tmp/context.png'],
      { model: 'gpt-5.6-sol', reasoningEffort: 'ultra' }
    );
    expect(mocks.clearPendingInitialPrompt).not.toHaveBeenCalled();
  });

  it('clears a pending SSH Codex prompt after remote startup resolves', async () => {
    mocks.resolveTask.mockReturnValue({
      conversations: {
        startSession: mocks.startSession,
        stopSession: mocks.stopSession,
      },
    });

    await restartConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.clearPendingInitialPrompt).toHaveBeenCalledWith('conversation-1', {
      projectId: 'project-1',
      taskId: 'task-1',
      deliveryToken: undefined,
    });
  });
});
