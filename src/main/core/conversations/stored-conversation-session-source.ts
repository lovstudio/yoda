import { and, eq, isNull } from 'drizzle-orm';
import type { AgentSessionSource } from '@shared/conversations';
import { db, sqlite } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { getReservedCodexThreadIds } from './codex-thread-reservations';
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
  source: AgentSessionSource,
  options: {
    projectId: string;
    taskId: string;
    expectedPendingAttemptStartedAtMs?: number;
  }
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [row] = await db
      .select({
        archivedAt: conversations.archivedAt,
        config: conversations.config,
        runtime: conversations.runtime,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, options.projectId),
          eq(conversations.taskId, options.taskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1);
    if (!row || row.archivedAt || row.runtime !== source.runtimeId) return false;

    const config = parseConversationConfig(row.config);
    const current = config.sessionSource;
    const bindingAlreadyStored =
      current?.catalogId === source.catalogId &&
      current.runtimeId === source.runtimeId &&
      current.sessionId === source.sessionId &&
      current.stateRoot === source.stateRoot &&
      current.providerId === source.providerId;
    if (bindingAlreadyStored && !config.pendingInitialPrompt) return true;
    if (
      options.expectedPendingAttemptStartedAtMs !== undefined &&
      config.pendingInitialPrompt?.attemptStartedAtMs !== options.expectedPendingAttemptStartedAtMs
    ) {
      return false;
    }

    // Session title discovery is heuristic for conversations created before
    // the provider thread id is known. This preflight gives a useful log; the
    // conditional write below is the authoritative cross-conversation guard.
    if (
      !bindingAlreadyStored &&
      source.runtimeId === 'codex' &&
      (await getReservedCodexThreadIds(conversationId)).has(source.sessionId)
    ) {
      log.warn('Skipped conflicting Codex session binding', {
        conversationId,
        threadId: source.sessionId,
      });
      return false;
    }

    // One SQLite statement both compares the config snapshot and verifies
    // native-thread ownership. SQLite serializes competing writers, so two
    // conversations cannot both pass NOT EXISTS and claim the same source.
    const { pendingInitialPrompt: _pendingInitialPrompt, ...acknowledgedConfig } = config;
    const nextConfig = JSON.stringify({ ...acknowledgedConfig, sessionSource: source });
    const result = sqlite
      .prepare(
        `
          UPDATE conversations
          SET config = ?, updated_at = ?
          WHERE id = ?
            AND project_id = ?
            AND task_id = ?
            AND archived_at IS NULL
            AND config IS ?
            AND NOT EXISTS (
              SELECT 1
              FROM conversations AS owner
              WHERE owner.id <> ?
                AND json_valid(owner.config) = 1
                AND json_extract(owner.config, '$.sessionSource.runtimeId') = ?
                AND json_extract(owner.config, '$.sessionSource.stateRoot') = ?
                AND json_extract(owner.config, '$.sessionSource.sessionId') = ?
            )
        `
      )
      .run(
        nextConfig,
        new Date().toISOString(),
        conversationId,
        options.projectId,
        options.taskId,
        row.config,
        conversationId,
        source.runtimeId,
        source.stateRoot,
        source.sessionId
      );
    if (result.changes === 1) return true;
  }

  log.warn('Skipped stale or conflicting conversation session binding', {
    conversationId,
    threadId: source.sessionId,
  });
  return false;
}

function parseConversationConfig(config: string | null): ConversationConfig {
  if (!config) return {};
  const parsed: unknown = JSON.parse(config);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as ConversationConfig;
}
