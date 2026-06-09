import { eq, inArray } from 'drizzle-orm';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { readClaudeTurnState } from './claude-run-state-source';
import { readCodexTurnState } from './codex-run-state-source';

/**
 * Stateless run-state for a task's conversations.
 *
 * The authority is NOT an in-memory map (which a main-process restart / HMR would
 * wipe, and which goes stale when a terminal event is missed). Instead each
 * conversation's status is *derived on demand* from a hook-independent source of
 * truth — the transcript the CLI itself writes (Claude transcript / Codex
 * rollout) — and gated by whether a PTY is actually connected.
 *
 * The in-memory store (`agentSessionRuntimeStore`) is kept only as a fast cache
 * for live in-session pushes; here it is just a fallback for providers without a
 * file truth source.
 */
export async function getConversationRuntimeStatuses(
  projectId: string,
  taskId: string,
  conversationIds: string[]
): Promise<Record<string, AgentSessionRuntimeStatus>> {
  const statuses: Record<string, AgentSessionRuntimeStatus> = {};
  if (conversationIds.length === 0) return statuses;

  const providerById = await loadProviders(conversationIds);
  const cwd = resolveTask(projectId, taskId)?.conversations.taskPath;

  await Promise.all(
    conversationIds.map(async (conversationId) => {
      statuses[conversationId] = await deriveStatus({
        projectId,
        taskId,
        conversationId,
        provider: providerById.get(conversationId),
        cwd,
      });
    })
  );

  return statuses;
}

/**
 * Stateless run-state for a single conversation. Shared by callers that already
 * know the provider + cwd (e.g. session summary), so derivation logic lives in
 * exactly one place.
 */
export async function getConversationRunStatus(args: {
  projectId: string;
  taskId: string;
  conversationId: string;
  provider: string;
  cwd: string;
}): Promise<AgentSessionRuntimeStatus> {
  return deriveStatus(args);
}

async function deriveStatus(args: {
  projectId: string;
  taskId: string;
  conversationId: string;
  provider: string | undefined;
  cwd: string | undefined;
}): Promise<AgentSessionRuntimeStatus> {
  const { projectId, taskId, conversationId, provider, cwd } = args;

  // Live in-memory state (set this session via hooks/tailers). Used as the base
  // and as the fallback for providers without a file truth source.
  const memory = agentSessionRuntimeStore.getStatus({ projectId, taskId, conversationId });

  // Truth source — overrides memory when available.
  let truth: AgentSessionRuntimeStatus | undefined;
  if (provider === 'claude' && cwd) {
    const t = await readClaudeTurnState(cwd, conversationId).catch(() => null);
    if (t) truth = t; // 'working' | 'awaiting-input' | 'idle'
  } else if (provider === 'codex') {
    const t = await readCodexTurnState(conversationId).catch(() => null);
    if (t === 'working') truth = 'working';
    else if (t === 'error') truth = 'error';
    else if (t === 'idle') truth = 'idle';
  }

  // The transcript truth source is authoritative: a turn is mid-flight iff the
  // CLI is genuinely processing (working) or blocked on the user (awaiting-input).
  // This is what makes the result survive a main-process restart / HMR and a
  // missed Stop hook — we never trust a persisted verdict, we re-derive it.
  //
  // When there is NO truth source (provider has none, or transcript unreadable)
  // we fall back to the in-memory cache, but a running fallback is only credible
  // while a PTY is actually connected — otherwise a stale `working` from before a
  // restart would survive. Truth-source verdicts are NOT gated this way (tmux
  // backends keep running without a connected PTY).
  let derived = truth ?? memory;
  if (truth === undefined && (derived === 'working' || derived === 'awaiting-input')) {
    if (!hasLivePty(projectId, taskId, conversationId)) derived = 'idle';
  }

  // Self-heal the in-memory cache so other readers and the next cold load agree.
  if (derived !== memory) {
    agentSessionRuntimeStore.setStatus({ projectId, taskId, conversationId }, derived);
  }
  return derived;
}

function hasLivePty(projectId: string, taskId: string, conversationId: string): boolean {
  const sessionId = makePtySessionId(projectId, taskId, conversationId);
  return ptySessionRegistry.get(sessionId) !== undefined;
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
