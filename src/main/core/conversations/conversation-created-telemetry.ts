import type { CreateConversationParams } from '@shared/conversations';
import type { TelemetryProperties } from '@shared/telemetry';

export function buildConversationCreatedTelemetry(
  params: CreateConversationParams,
  conversationId: string,
  isFirstInTask: boolean
): TelemetryProperties<'conversation_created'> {
  return {
    provider: params.runtime,
    is_first_in_task: isFirstInTask,
    source: params.clientSource ?? 'desktop',
    project_id: params.projectId,
    task_id: params.taskId,
    conversation_id: conversationId,
  };
}
