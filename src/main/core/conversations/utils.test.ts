import { describe, expect, it } from 'vitest';
import type { ConversationRow } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

function conversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Conversation',
    titleSource: null,
    runtime: 'codex',
    authProvider: null,
    config: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    lastInteractedAt: null,
    isInitialConversation: false,
    archivedAt: null,
    forkedFromConversationId: null,
    forkedFromPromptIndex: null,
    ...overrides,
  };
}

describe('mapConversationRowToConversation', () => {
  it('preserves a zero-based fork point', () => {
    expect(
      mapConversationRowToConversation(
        conversationRow({
          forkedFromConversationId: 'parent-conversation',
          forkedFromPromptIndex: 0,
        })
      )
    ).toMatchObject({
      forkedFromConversationId: 'parent-conversation',
      forkedFromPromptIndex: 0,
    });
  });

  it('maps nullable lineage to a root conversation', () => {
    const conversation = mapConversationRowToConversation(conversationRow());

    expect(conversation.forkedFromConversationId).toBeUndefined();
    expect(conversation.forkedFromPromptIndex).toBeUndefined();
  });

  it('keeps provider-native source coordinates separate from the Yoda conversation id', () => {
    const conversation = mapConversationRowToConversation(
      conversationRow({
        id: 'yoda-conversation',
        config: JSON.stringify({
          sessionSource: {
            catalogId: 'catalog-1',
            runtimeId: 'codex',
            sessionId: 'native-thread',
            stateRoot: '/state/account-a',
            providerId: 'provider-a',
          },
        }),
      })
    );

    expect(conversation.id).toBe('yoda-conversation');
    expect(conversation.sessionSource).toEqual({
      catalogId: 'catalog-1',
      runtimeId: 'codex',
      sessionId: 'native-thread',
      stateRoot: '/state/account-a',
      providerId: 'provider-a',
    });
  });
});
