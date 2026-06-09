import { eq } from 'drizzle-orm';
import { conversationRenamedChannel } from '@shared/events/conversationEvents';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { conversationEvents } from './conversation-events';

export async function renameConversation(
  conversationId: string,
  name: string,
  source: 'user' | 'yoda' = 'user'
) {
  const [existing] = await db
    .select({ projectId: conversations.projectId, taskId: conversations.taskId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  await db
    .update(conversations)
    .set({ title: name, titleSource: source })
    .where(eq(conversations.id, conversationId));

  if (existing) {
    conversationEvents._emit(
      'conversation:renamed',
      conversationId,
      existing.projectId,
      existing.taskId,
      name
    );
    events.emit(conversationRenamedChannel, {
      conversationId,
      projectId: existing.projectId,
      taskId: existing.taskId,
      title: name,
    });
  }
}
