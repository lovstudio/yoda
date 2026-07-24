import { and, eq, ne } from 'drizzle-orm';
import { conversations } from '@main/db/schema';

/**
 * Codex provider forks that already belong to another Yoda conversation must
 * not be treated as an in-place rewind continuation of the current session.
 */
export async function getReservedCodexThreadIds(
  currentConversationId: string
): Promise<ReadonlySet<string>> {
  try {
    // Keep this import lazy: transcript/session-id parsers are also exercised in
    // isolated tests and recovery paths where the app database is unavailable.
    const { db } = await import('@main/db/client');
    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.runtime, 'codex'), ne(conversations.id, currentConversationId)));
    return new Set(rows.map((row) => row.id));
  } catch {
    return new Set();
  }
}
