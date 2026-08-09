import { describe, expect, it } from 'vitest';
import {
  buildAiLabAppDeepLink,
  buildFileDeepLink,
  buildProjectDeepLink,
  buildSessionDeepLink,
  buildTaskDeepLink,
  isYodaDeepLinkUrl,
  parseYodaDeepLink,
} from './deep-links';

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

  it('builds task links that round-trip through the parser', () => {
    expect(buildTaskDeepLink({ projectId: 'project-1', taskId: 'task-1' })).toBe(
      'yoda://task/project-1/task-1'
    );
    const withSession = buildTaskDeepLink({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    });
    expect(parseYodaDeepLink(withSession)).toEqual({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
    });
  });

  it('builds project links that round-trip through the parser', () => {
    expect(buildProjectDeepLink({ projectId: 'project-1' })).toBe('yoda://project/project-1');
    expect(parseYodaDeepLink('yoda://project/project-1')).toEqual({ projectId: 'project-1' });
  });

  it('builds AI Lab app links that round-trip through the parser', () => {
    expect(buildAiLabAppDeepLink({ appId: 'app / 测试' })).toBe(
      'yoda://app/app%20%2F%20%E6%B5%8B%E8%AF%95'
    );
    expect(parseYodaDeepLink('yoda://app/app%20%2F%20%E6%B5%8B%E8%AF%95')).toEqual({
      appId: 'app / 测试',
    });
  });

  it('builds file links that round-trip through the parser', () => {
    const link = buildFileDeepLink({ filePath: '/tmp/design draft.png' });
    expect(link).toBe('yoda://open?path=%2Ftmp%2Fdesign+draft.png');
    expect(parseYodaDeepLink(link)).toEqual({ filePath: '/tmp/design draft.png' });
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
