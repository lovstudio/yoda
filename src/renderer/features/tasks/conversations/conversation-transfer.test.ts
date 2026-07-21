import { describe, expect, it } from 'vitest';
import {
  canMoveConversationToTask,
  conversationTransferFromPayload,
} from './conversation-transfer';

describe('conversation transfer payloads', () => {
  it('accepts a direct session-panel drag only for another task in the same project', () => {
    const payload = {
      kind: 'conversation-transfer' as const,
      projectId: 'project-1',
      sourceTaskId: 'task-1',
      conversationId: 'conversation-1',
    };

    expect(canMoveConversationToTask(payload, 'project-1', 'task-2')).toBe(true);
    expect(canMoveConversationToTask(payload, 'project-1', 'task-1')).toBe(false);
    expect(canMoveConversationToTask(payload, 'project-2', 'task-2')).toBe(false);
  });

  it('normalizes a conversation tab drag into the same transfer contract', () => {
    expect(
      conversationTransferFromPayload({
        kind: 'task-entity',
        from: 'strip',
        projectId: 'project-1',
        taskId: 'task-1',
        target: { kind: 'conversation', conversationId: 'conversation-1' },
      })
    ).toEqual({
      projectId: 'project-1',
      sourceTaskId: 'task-1',
      conversationId: 'conversation-1',
    });
  });

  it('rejects non-conversation task entities', () => {
    expect(
      conversationTransferFromPayload({
        kind: 'task-entity',
        from: 'strip',
        projectId: 'project-1',
        taskId: 'task-1',
        target: { kind: 'file', path: 'README.md' },
      })
    ).toBeNull();
  });
});
