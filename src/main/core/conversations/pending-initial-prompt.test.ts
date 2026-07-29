import { describe, expect, it } from 'vitest';
import {
  hydratedConversationStart,
  pendingInitialPromptFromParams,
  withoutPendingInitialPrompt,
} from './pending-initial-prompt';

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
      })
    ).toEqual({
      prompt: 'Restore the original context',
      imagePaths: ['/tmp/context.png'],
      model: null,
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
        },
      })
    ).toEqual({
      isResuming: false,
      initialPrompt: 'Restore the original context',
      imagePaths: ['/tmp/context.png'],
      model: null,
    });
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
