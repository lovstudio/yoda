import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { isAgentSessionRunningStatus, type PersistedRunStatus } from '@shared/events/agentEvents';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { AgentSessionKey } from './agent-session-runtime';

const DB_QUERY_CHUNK_SIZE = 250;

/**
 * Remember how a session's last turn ended, so the outcome outlives this process.
 *
 * Wired into the run-state reducer's single dispatch path at boot rather than
 * imported by it: the reducer is on the hot path of every unit test, and pulling
 * the database client into its module graph would open a real database file
 * there.
 */
export async function persistConversationRunOutcome(
  conversationId: string,
  status: PersistedRunStatus
): Promise<void> {
  try {
    // Guarded so re-recording the same outcome is a genuine no-op. `updatedAt`
    // has `$onUpdate` and feeds session ordering, so an unconditional write
    // would reshuffle session lists on every cold load that re-derives a status.
    await db
      .update(conversations)
      .set({ lastRunStatus: status })
      .where(
        and(
          eq(conversations.id, conversationId),
          or(isNull(conversations.lastRunStatus), ne(conversations.lastRunStatus, status))
        )
      );
  } catch (error) {
    log.warn('Failed to persist conversation run outcome', {
      conversationId,
      status,
      error: String(error),
    });
  }
}

/**
 * Read a stored outcome back as a runtime status.
 *
 * A stored *running* status means a turn started and this process never observed
 * it end — the app or the CLI went away with work in flight, which is the same
 * fact as an explicit interrupt approached from the other side.
 */
export function runtimeStatusFromRunOutcome(
  stored: PersistedRunStatus | null | undefined
): PersistedRunStatus | undefined {
  if (!stored) return undefined;
  return isAgentSessionRunningStatus(stored) ? 'interrupted' : stored;
}

/** Stored outcome for one conversation, for callers that hold no row. */
export async function readConversationRunOutcome(
  conversationId: string
): Promise<PersistedRunStatus | undefined> {
  const rows = await db
    .select({ lastRunStatus: conversations.lastRunStatus })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  return runtimeStatusFromRunOutcome(rows[0]?.lastRunStatus);
}

/**
 * Every visible session in the given projects whose last outcome is only known
 * to the database — no live process, no in-memory entry, nothing to re-derive.
 *
 * Bounded by what the user still has in view (archived projects, tasks and
 * conversations are excluded), so this stays a single indexed-scope query and
 * does not reintroduce a startup cost proportional to all history.
 */
export async function loadPersistedRunOutcomes(
  projectIds: string[]
): Promise<Array<AgentSessionKey & { status: PersistedRunStatus }>> {
  if (projectIds.length === 0) return [];

  const result: Array<AgentSessionKey & { status: PersistedRunStatus }> = [];
  for (let offset = 0; offset < projectIds.length; offset += DB_QUERY_CHUNK_SIZE) {
    const ids = projectIds.slice(offset, offset + DB_QUERY_CHUNK_SIZE);
    const rows = await db
      .select({
        projectId: conversations.projectId,
        taskId: conversations.taskId,
        conversationId: conversations.id,
        lastRunStatus: conversations.lastRunStatus,
      })
      .from(conversations)
      .innerJoin(tasks, eq(conversations.taskId, tasks.id))
      .innerJoin(projects, eq(conversations.projectId, projects.id))
      .where(
        and(
          inArray(conversations.projectId, ids),
          isNotNull(conversations.lastRunStatus),
          isNull(conversations.archivedAt),
          isNull(tasks.archivedAt),
          isNull(projects.archivedAt)
        )
      );
    for (const row of rows) {
      const status = runtimeStatusFromRunOutcome(row.lastRunStatus);
      if (!status) continue;
      result.push({
        projectId: row.projectId,
        taskId: row.taskId,
        conversationId: row.conversationId,
        status,
      });
    }
  }
  return result;
}
