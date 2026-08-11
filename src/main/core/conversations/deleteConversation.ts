import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { cancelConversationHydrationBarrier } from './conversation-hydration-barrier';
import { withConversationOperation } from './conversation-operation-lock';

export async function deleteConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  cancelConversationHydrationBarrier(projectId, taskId, conversationId);
  return withConversationOperation({ projectId, id: conversationId }, async () => {
    const [deleted] = await db
      .delete(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId)
        )
      )
      .returning({ id: conversations.id });
    if (!deleted) return;

    conversationEvents._emit('conversation:deleted', conversationId);

    const task = resolveTask(projectId, taskId);
    await task?.conversations.stopSession(conversationId);
    telemetryService.capture('conversation_deleted', {
      project_id: projectId,
      task_id: taskId,
      conversation_id: conversationId,
    });
  });
}
