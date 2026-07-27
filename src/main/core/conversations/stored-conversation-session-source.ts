import { eq } from 'drizzle-orm';
import type { AgentSessionSource } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { parseConversationSessionSource } from './conversation-session-source';

export async function getStoredConversationSessionSource(
  conversationId: string
): Promise<AgentSessionSource | undefined> {
  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return parseConversationSessionSource(row?.config);
}
