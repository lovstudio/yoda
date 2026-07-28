import { describe, expect, it } from 'vitest';
import type { Conversation, LocalAgentSession } from '@shared/conversations';
import { mergeProjectSessionItems } from './project-session-items';

const localSession: LocalAgentSession = {
  catalogId: 'catalog-1',
  runtimeId: 'codex',
  sessionId: 'native-1',
  stateRoot: '/state/account-a',
  providerId: 'provider-a',
  cwd: '/project',
  title: 'Local session',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
  transcriptPath: '/state/account-a/session.jsonl',
  archived: false,
};

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'yoda-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtimeId: 'codex',
    title: 'Yoda session',
    lastInteractedAt: '2026-01-02T00:00:00.000Z',
    isInitialConversation: true,
    ...overrides,
  };
}

describe('mergeProjectSessionItems', () => {
  it('shows unlinked local sessions alongside Yoda conversations in timestamp order', () => {
    expect(mergeProjectSessionItems([conversation()], [localSession])).toEqual([
      { kind: 'local-agent', session: localSession },
      { kind: 'conversation', conversation: conversation() },
    ]);
  });

  it('deduplicates an adopted source by catalog id', () => {
    const adopted = conversation({
      sessionSource: {
        catalogId: localSession.catalogId,
        runtimeId: 'codex',
        sessionId: localSession.sessionId,
        stateRoot: localSession.stateRoot,
        providerId: localSession.providerId,
      },
    });

    expect(mergeProjectSessionItems([adopted], [localSession])).toEqual([
      { kind: 'conversation', conversation: adopted },
    ]);
  });

  it('deduplicates legacy Yoda conversations whose id is the native session id', () => {
    const legacy = conversation({ id: localSession.sessionId });
    expect(mergeProjectSessionItems([legacy], [localSession])).toEqual([
      { kind: 'conversation', conversation: legacy },
    ]);
  });
});
