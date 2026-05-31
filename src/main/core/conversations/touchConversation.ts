import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';

export async function touchConversation(
  conversationId: string,
  lastInteractedAt: string
): Promise<void> {
  const [conversation] = await db
    .select({ taskId: conversations.taskId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conversation) return;

  await db
    .update(conversations)
    .set({ lastInteractedAt })
    .where(eq(conversations.id, conversationId));
  await db.update(tasks).set({ lastInteractedAt }).where(eq(tasks.id, conversation.taskId));
}
