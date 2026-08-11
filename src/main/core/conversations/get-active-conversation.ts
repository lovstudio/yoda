import { and, eq, isNull } from 'drizzle-orm';
import type { Conversation } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

/** Revalidate persisted ownership immediately before a captured conversation is started. */
export async function getActiveConversation(
  conversation: Pick<Conversation, 'id' | 'projectId' | 'taskId'>
): Promise<Conversation | undefined> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversation.id),
        eq(conversations.projectId, conversation.projectId),
        eq(conversations.taskId, conversation.taskId),
        isNull(conversations.archivedAt)
      )
    )
    .limit(1);
  return row ? mapConversationRowToConversation(row, true) : undefined;
}
