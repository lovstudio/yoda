import { eq, inArray } from 'drizzle-orm';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { readClaudeTurnState } from './claude-run-state-source';

/**
 * Cold-load run-state for a task's conversations.
 *
 * The in-memory store is the live authority, but it depends on terminal events
 * (the `Stop` hook for Claude) actually being delivered. When one is missed the
 * store stays pinned at `working` and re-opening the session would re-hydrate
 * that stale value. To self-heal, any conversation the store still reports as
 * `working` is cross-checked against a hook-independent source of truth (the
 * Claude transcript) and corrected to `idle` if the turn has actually ended.
 */
export async function getConversationRuntimeStatuses(
  projectId: string,
  taskId: string,
  conversationIds: string[]
): Promise<Record<string, AgentSessionRuntimeStatus>> {
  const statuses: Record<string, AgentSessionRuntimeStatus> = {};
  for (const conversationId of conversationIds) {
    statuses[conversationId] = agentSessionRuntimeStore.getStatus({
      projectId,
      taskId,
      conversationId,
    });
  }

  // Only sessions the store thinks are running can be falsely stuck; nothing
  // else needs correcting, so skip the disk reads entirely when none are.
  const stuckCandidates = conversationIds.filter((id) => statuses[id] === 'working');
  if (stuckCandidates.length === 0) return statuses;

  const cwd = resolveTask(projectId, taskId)?.conversations.taskPath;
  if (!cwd) return statuses;

  const providerById = await loadProviders(stuckCandidates);
  await Promise.all(
    stuckCandidates.map(async (conversationId) => {
      if (providerById.get(conversationId) !== 'claude') return;
      const turnState = await readClaudeTurnState(cwd, conversationId).catch(() => null);
      if (turnState === 'idle') {
        statuses[conversationId] = 'idle';
        // Correct the in-memory authority too, so the stale value doesn't leak
        // back out through other readers or the next cold load.
        agentSessionRuntimeStore.dispatch(
          { projectId, taskId, conversationId },
          { kind: 'watchdog-idle', at: Date.now() },
          'cold-load-transcript'
        );
      }
    })
  );

  return statuses;
}

async function loadProviders(conversationIds: string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: conversations.id, provider: conversations.provider })
    .from(conversations)
    .where(
      conversationIds.length === 1
        ? eq(conversations.id, conversationIds[0])
        : inArray(conversations.id, conversationIds)
    );
  return new Map(rows.flatMap((r) => (r.provider ? [[r.id, r.provider] as const] : [])));
}
