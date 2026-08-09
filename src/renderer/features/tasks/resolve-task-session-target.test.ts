import { describe, expect, it, vi } from 'vitest';
import { resolveLastTaskSessionTarget } from './resolve-task-session-target';

describe('resolveLastTaskSessionTarget', () => {
  it('prefers the latest conversation history entry over Overview', () => {
    const topLevelTargetForTabId = vi.fn((tabId: string) => {
      if (tabId === 'overview') return { kind: 'overview' as const };
      if (tabId === 'session-a') {
        return { kind: 'conversation' as const, conversationId: 'conversation-a' };
      }
      return undefined;
    });

    const target = resolveLastTaskSessionTarget(
      {
        lastTaskTab: vi.fn((_projectId, _taskId, matches) => {
          for (const tabId of ['overview', 'session-a']) {
            if (matches?.(tabId)) return tabId;
          }
          return undefined;
        }),
      },
      {
        topLevelTargetForTabId,
        activeTopLevelTarget: null,
        preferredConversationTarget: null,
      },
      'project-1',
      'task-1'
    );

    expect(target).toEqual({ kind: 'conversation', conversationId: 'conversation-a' });
  });

  it('uses the preferred conversation when Overview is the active tab', () => {
    const target = resolveLastTaskSessionTarget(
      {
        lastTaskTab: vi.fn(() => undefined),
      },
      {
        topLevelTargetForTabId: vi.fn(),
        activeTopLevelTarget: null,
        preferredConversationTarget: {
          kind: 'conversation',
          conversationId: 'conversation-a',
        },
      },
      'project-1',
      'task-1'
    );

    expect(target).toEqual({ kind: 'conversation', conversationId: 'conversation-a' });
  });
});
