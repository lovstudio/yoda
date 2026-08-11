import { describe, expect, it } from 'vitest';
import {
  hydratedConversationStart,
  pendingInitialPromptFromParams,
  shouldClearPendingInitialPromptAfterStart,
  withoutPendingInitialPrompt,
} from './pending-initial-prompt';
import type { ConversationProvider } from './types';

describe('pending initial prompt delivery', () => {
  it('persists a non-deferred first prompt until Agent startup succeeds', () => {
    expect(
      pendingInitialPromptFromParams({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtime: 'codex',
        title: 'Recover me',
        initialPrompt: 'Restore the original context',
        imagePaths: ['/tmp/context.png'],
        model: null,
        reasoningEffort: 'high',
      })
    ).toEqual({
      prompt: 'Restore the original context',
      imagePaths: ['/tmp/context.png'],
      model: null,
      reasoningEffort: 'high',
    });
  });

  it('does not claim deferred sessions', () => {
    expect(
      pendingInitialPromptFromParams({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtime: 'codex',
        title: 'Deferred',
        initialPrompt: 'Send later',
        deferInitialPrompt: true,
      })
    ).toBeUndefined();
  });

  it('starts an undelivered persisted prompt as a fresh Agent session', () => {
    expect(
      hydratedConversationStart({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        runtimeId: 'codex',
        title: 'Recover me',
        lastInteractedAt: null,
        isInitialConversation: true,
        pendingInitialPrompt: {
          prompt: 'Restore the original context',
          imagePaths: ['/tmp/context.png'],
          model: null,
          reasoningEffort: 'high',
        },
      })
    ).toEqual({
      isResuming: false,
      initialPrompt: 'Restore the original context',
      imagePaths: ['/tmp/context.png'],
      model: null,
      reasoningEffort: 'high',
    });
  });

  it('uses provider capability to choose the first-prompt acknowledgement', () => {
    const localProvider: Pick<ConversationProvider, 'waitsForInitialPromptSessionBinding'> = {
      waitsForInitialPromptSessionBinding: (runtimeId) => runtimeId === 'codex',
    };
    const sshProvider = {};

    expect(shouldClearPendingInitialPromptAfterStart(localProvider, 'codex')).toBe(false);
    expect(shouldClearPendingInitialPromptAfterStart(localProvider, 'claude')).toBe(true);
    expect(shouldClearPendingInitialPromptAfterStart(sshProvider, 'codex')).toBe(true);
  });

  it('clears only the delivery marker and preserves conversation settings', () => {
    expect(
      withoutPendingInitialPrompt(
        JSON.stringify({
          autoApprove: true,
          permissionMode: 'bypass',
          pendingInitialPrompt: { prompt: 'Restore the original context' },
        })
      )
    ).toBe(JSON.stringify({ autoApprove: true, permissionMode: 'bypass' }));
    expect(
      withoutPendingInitialPrompt(
        JSON.stringify({
          pendingInitialPrompt: { prompt: 'Restore the original context' },
        })
      )
    ).toBeNull();
  });
});
