import { eq } from 'drizzle-orm';
import type { AgentSessionSource } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { parseConversationSessionSource } from './conversation-session-source';
import type { ConversationConfig } from './types';

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

export async function storeConversationSessionSource(
  conversationId: string,
  source: AgentSessionSource
): Promise<boolean> {
  const [row] = await db
    .select({ config: conversations.config, runtime: conversations.runtime })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row || row.runtime !== source.runtimeId) return false;

  const config = parseConversationConfig(row.config);
  const current = config.sessionSource;
  if (
    current?.catalogId === source.catalogId &&
    current.runtimeId === source.runtimeId &&
    current.sessionId === source.sessionId &&
    current.stateRoot === source.stateRoot &&
    current.providerId === source.providerId
  ) {
    return false;
  }

  await db
    .update(conversations)
    .set({ config: JSON.stringify({ ...config, sessionSource: source }) })
    .where(eq(conversations.id, conversationId));
  return true;
}

function parseConversationConfig(config: string | null): ConversationConfig {
  if (!config) return {};
  const parsed: unknown = JSON.parse(config);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as ConversationConfig;
}
