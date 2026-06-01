import { describe, expect, it } from 'vitest';
import { buildSessionDeepLink, isYodaDeepLinkUrl, parseYodaDeepLink } from './deep-links';

describe('deep links', () => {
  it('parses session links', () => {
    expect(parseYodaDeepLink('yoda://session/conversation-1')).toEqual({
      conversationId: 'conversation-1',
    });
  });

  it('parses task links with session and prompt path segments', () => {
    expect(
      parseYodaDeepLink('yoda://task/project-1/task-1/session/conversation-1/prompt/prompt-1')
    ).toEqual({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptId: 'prompt-1',
    });
  });

  it('parses query-param prompt targets', () => {
    expect(
      parseYodaDeepLink(
        'yoda://open?projectId=project-1&taskId=task-1&sessionId=conversation-1&promptIndex=2'
      )
    ).toEqual({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      promptIndex: 2,
    });
  });

  it('builds session links', () => {
    expect(buildSessionDeepLink({ conversationId: 'conversation-1', promptId: 'prompt-1' })).toBe(
      'yoda://session/conversation-1?promptId=prompt-1'
    );
  });

  it('rejects non-yoda schemes', () => {
    expect(isYodaDeepLinkUrl('https://session/conversation-1')).toBe(false);
    expect(parseYodaDeepLink('https://session/conversation-1')).toBeNull();
  });
});
