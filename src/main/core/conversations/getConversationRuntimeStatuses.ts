import { eq, inArray } from 'drizzle-orm';
import {
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { readClaudeTurnVerdictFile } from './claude-run-state-source';
import { findClaudeTranscriptPathBySessionId } from './claude-transcript-locator';
import { readCodexTurnVerdict } from './codex-run-state-source';
import { resolveCodexThreadIdForConversation } from './codex-session-id';
import { isInterruptedSinceLastPrompt } from './interrupt-marker';

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

  const conversationById = await loadConversationRows(conversationIds);
  const cwd = resolveTask(projectId, taskId)?.conversations.taskPath;

  for (const conversationId of conversationIds) {
    const row = conversationById.get(conversationId);
    statuses[conversationId] = await deriveStatus({
      projectId,
      taskId,
      conversationId,
      provider: row?.runtime ?? undefined,
      createdAt: row?.createdAt,
      title: row?.title,
      cwd,
    });
  }

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
  createdAt?: string | null;
  title?: string | null;
}): Promise<AgentSessionRuntimeStatus> {
  return deriveStatus(args);
}

async function deriveStatus(args: {
  projectId: string;
  taskId: string;
  conversationId: string;
  provider: string | undefined;
  createdAt?: string | null;
  title?: string | null;
  cwd: string | undefined;
}): Promise<AgentSessionRuntimeStatus> {
  const { projectId, taskId, conversationId, provider, createdAt, title, cwd } = args;
  const mountedTask = resolveTask(projectId, taskId);

  // Live in-memory state (set this session via hooks/tailers). Used as the base
  // and as the fallback for providers without a file truth source.
  const memory = agentSessionRuntimeStore.getStatus({ projectId, taskId, conversationId });

  // Truth source — overrides memory when available.
  let truth: AgentSessionRuntimeStatus | undefined;
  if (provider === 'claude') {
    // Without a cwd (task not provisioned — e.g. cold load right after an app
    // restart while the agent keeps running in tmux), locate the transcript by
    // session id instead so the status still derives from the truth source.
    const filePath = cwd
      ? resolveClaudeTranscriptPath(cwd, conversationId)
      : await findClaudeTranscriptPathBySessionId(conversationId);
    if (filePath) {
      const verdict = await readClaudeTurnVerdictFile(filePath).catch(() => null);
      if (verdict) {
        truth = verdict.state; // 'working' | 'awaiting-input' | 'idle'
        // A `working` verdict frozen since before a user interrupt is stale: a
        // turn killed before its first assistant output leaves no interrupt
        // sentinel and no stop row, so the transcript alone can never leave
        // `working`. The marker (set by the stop button / a typed Esc) breaks
        // the tie; a newer prompt row invalidates it automatically.
        if (
          truth === 'working' &&
          isInterruptedSinceLastPrompt(conversationId, verdict.lastUserAt)
        ) {
          truth = 'idle';
        }
      }
    }
  } else if (provider === 'codex') {
    const startedAtMs = parseTimestampMs(createdAt);
    const threadId = resolveCodexThreadIdForConversation({
      conversationId,
      cwd,
      title: title ?? undefined,
      createdAt,
    });
    const verdict = await readCodexTurnVerdict(
      conversationId,
      cwd && startedAtMs !== undefined ? { cwd, startedAtMs, threadId } : { threadId }
    ).catch(() => null);
    if (verdict?.state === 'working' || verdict?.state === 'awaiting-input') truth = verdict.state;
    else if (verdict?.state === 'error') truth = 'error';
    else if (verdict?.state === 'idle') truth = 'idle';
  }

  // The transcript truth source is the primary authority: a turn is mid-flight
  // iff the CLI is processing or blocked on the user. This survives a main-
  // process restart / HMR and missed hooks because we re-derive it from the
  // file source of truth.
  //
  // There is one local-UI caveat: for a mounted task, if there is neither a
  // connected PTY nor an active provider session, a transcript-only `working`
  // verdict is stale (e.g. Esc killed the turn before Claude wrote an interrupt
  // sentinel). Cold-load/unmounted tasks stay transcript-authoritative so tmux
  // sessions can still be shown as running without a connected PTY.
  // Transcript classifiers intentionally collapse a cleanly finished turn to
  // `idle`. Do not let that less-specific durable verdict erase a precise
  // terminal status already observed by the live run-state reducer. A later
  // `working`/`awaiting-input` truth still wins when the next turn starts.
  let derived =
    truth === 'idle' && (memory === 'completed' || memory === 'error') ? memory : (truth ?? memory);
  if (isAgentSessionRunningStatus(derived)) {
    const livePty = hasLivePty(projectId, taskId, conversationId);
    if (truth === undefined) {
      if (!livePty) derived = 'idle';
    } else if (
      mountedTask &&
      !livePty &&
      !mountedTask.conversations
        .getActiveSessions()
        .some((session) => session.conversationId === conversationId)
    ) {
      derived = 'idle';
    }
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

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

async function loadConversationRows(
  conversationIds: string[]
): Promise<
  Map<string, { runtime: string | null; createdAt: string | null; title: string | null }>
> {
  const rows = await db
    .select({
      id: conversations.id,
      runtime: conversations.runtime,
      createdAt: conversations.createdAt,
      title: conversations.title,
    })
    .from(conversations)
    .where(
      conversationIds.length === 1
        ? eq(conversations.id, conversationIds[0])
        : inArray(conversations.id, conversationIds)
    );
  return new Map(
    rows.map((r) => [r.id, { runtime: r.runtime, createdAt: r.createdAt, title: r.title }])
  );
}
