import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { resolveTaskMenuSessionFields } from './task-menu-session-info';

const mocks = vi.hoisted(() => ({
  getConversationSessionInfo: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    conversations: {
      getConversationSessionInfo: mocks.getConversationSessionInfo,
    },
  },
}));

describe('resolveTaskMenuSessionFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the resolved session title with the resolved session id', async () => {
    mocks.getConversationSessionInfo.mockResolvedValue({
      sessionId: 'actual-codex-thread',
      sessionTitle: 'Actual Codex title',
      resumeCommand: 'codex resume actual-codex-thread',
      running: true,
      tmuxEnabled: true,
    });

    const fields = await resolveTaskMenuSessionFields(makeConversation(), '/repo');

    expect(mocks.getConversationSessionInfo).toHaveBeenCalledWith(
      'project-1',
      'task-1',
      'conversation-1',
      '/repo'
    );
    expect(fields).toEqual({
      providerId: 'codex',
      sessionId: 'actual-codex-thread',
      sessionTitle: 'Actual Codex title',
      providerName: 'Codex',
      resumeCommand: 'codex resume actual-codex-thread',
      running: true,
      tmuxEnabled: true,
    });
  });

  it('falls back to the conversation title when the resolved info omits a title', async () => {
    mocks.getConversationSessionInfo.mockResolvedValue({
      sessionId: 'actual-codex-thread',
    });

    const fields = await resolveTaskMenuSessionFields(makeConversation(), '/repo');

    expect(fields.sessionId).toBe('actual-codex-thread');
    expect(fields.sessionTitle).toBe('Yoda conversation title');
  });
});

function makeConversation(): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Yoda conversation title',
    lastInteractedAt: '2026-06-04T06:45:36.000Z',
    isInitialConversation: true,
  };
}
