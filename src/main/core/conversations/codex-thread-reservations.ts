import { and, eq, ne } from 'drizzle-orm';
import { conversations } from '@main/db/schema';
import { parseConversationSessionSource } from './conversation-session-source';

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
      .select({ id: conversations.id, config: conversations.config })
      .from(conversations)
      .where(and(eq(conversations.runtime, 'codex'), ne(conversations.id, currentConversationId)));
    const reserved = new Set<string>();
    for (const row of rows) {
      reserved.add(row.id);
      const source = parseConversationSessionSource(row.config);
      if (source?.runtimeId === 'codex') reserved.add(source.sessionId);
    }
    return reserved;
  } catch {
    return new Set();
  }
}
