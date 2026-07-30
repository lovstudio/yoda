import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { withoutPendingInitialPrompt } from './pending-initial-prompt';

export async function clearPendingInitialPrompt(conversationId: string): Promise<void> {
  const [row] = await db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) return;
  const config = withoutPendingInitialPrompt(row.config);
  if (config === row.config) return;
  await db.update(conversations).set({ config }).where(eq(conversations.id, conversationId));
}
