import { describe, expect, it } from 'vitest';
import type { CreateConversationParams } from '@shared/conversations';
import { buildConversationCreatedTelemetry } from './conversation-created-telemetry';

function conversationParams(
  overrides: Partial<CreateConversationParams> = {}
): CreateConversationParams {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runtime: 'codex',
    title: 'Test conversation',
    ...overrides,
  };
}

describe('buildConversationCreatedTelemetry', () => {
  it('defaults conversations to the desktop source', () => {
    expect(buildConversationCreatedTelemetry(conversationParams(), 'conversation-1', true)).toEqual(
      {
        provider: 'codex',
        is_first_in_task: true,
        source: 'desktop',
        project_id: 'project-1',
        task_id: 'task-1',
        conversation_id: 'conversation-1',
      }
    );
  });

  it('preserves an explicit mobile source', () => {
    expect(
      buildConversationCreatedTelemetry(
        conversationParams({ clientSource: 'mobile' }),
        'conversation-2',
        false
      )
    ).toMatchObject({
      provider: 'codex',
      is_first_in_task: false,
      source: 'mobile',
      conversation_id: 'conversation-2',
    });
  });
});
