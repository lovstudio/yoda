import { eq, inArray } from 'drizzle-orm';
import type { AgentSessionSource } from '@shared/conversations';
import {
  isAgentSessionRunningStatus,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { isValidRuntimeId } from '@shared/runtime-registry';
import { resolveRuntimeStatusMonitor } from '@shared/runtime-status-monitor';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { resolveCodexStatePath } from '@main/core/session-title/codex-title-source';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { readClaudeTurnVerdictFile } from './claude-run-state-source';
import { getClaudeSessionActivity } from './claude-session-activity-source';
import { findClaudeTranscriptPathBySessionId } from './claude-transcript-locator';
import { readCodexTurnVerdict } from './codex-run-state-source';
import { resolveCodexThreadIdForConversation } from './codex-session-id';
import { getReservedCodexThreadIds } from './codex-thread-reservations';
import { parseConversationSessionSource } from './conversation-session-source';
import { isInterruptedSinceLastPrompt } from './interrupt-marker';
import { runtimeStatusMonitorRegistry } from './runtime-status-monitor-registry';

/**
 * Stateless run-state for a task's conversations.
 *
 * The authority is NOT an in-memory map (which a main-process restart / HMR would
 * wipe, and which goes stale when a terminal event is missed). Instead each
 * conversation's status is *derived on demand* from a hook-independent source of
 * truth selected for that client — for example Claude's PID activity record or
 * Codex's rollout — and gated by whether a PTY is actually connected.
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
    const session = { projectId, taskId, conversationId };
    statuses[conversationId] = await deriveStatus({
      ...session,
      provider: row?.runtime ?? undefined,
      createdAt: row?.createdAt,
      title: row?.title,
      sessionSource: row?.sessionSource,
      cwd,
    });
    // Keep the RPC return type status-only, while also delivering the current
    // provider fence to a newly-created ConversationStore. Main emits this
    // before the RPC response resolves, so the renderer's revision guard keeps
    // the richer snapshot from being overwritten by the status-only payload.
    agentSessionRuntimeStore.publishSnapshot(session);
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
  sessionSource?: AgentSessionSource;
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
  sessionSource?: AgentSessionSource;
  cwd: string | undefined;
}): Promise<AgentSessionRuntimeStatus> {
  const { projectId, taskId, conversationId, provider, createdAt, title, sessionSource, cwd } =
    args;
  const mountedTask = resolveTask(projectId, taskId);
  const activeSession = mountedTask?.conversations
    .getActiveSessions()
    .find((session) => session.conversationId === conversationId);
  const runtimeId = isValidRuntimeId(provider) ? provider : undefined;
  const statusMonitor = runtimeId
    ? (runtimeStatusMonitorRegistry.get(conversationId) ??
      resolveRuntimeStatusMonitor(
        runtimeId,
        (await runtimeOverrideSettings.getItem(runtimeId))?.statusMonitor
      ))
    : undefined;

  // Live in-memory state (set this session via hooks/tailers). Used as the base
  // and as the fallback for providers without a file truth source.
  const session = { projectId, taskId, conversationId };
  const memory = agentSessionRuntimeStore.getStatus(session);
  const providerTurnWasConfirmed = agentSessionRuntimeStore.isProviderTurnConfirmed(session);

  // Truth source — overrides memory when available.
  let truth: AgentSessionRuntimeStatus | undefined;
  if (provider === 'claude' && statusMonitor === 'activity') {
    const sessionId =
      sessionSource?.runtimeId === 'claude' ? sessionSource.sessionId : conversationId;
    const activity = await getClaudeSessionActivity({
      cwd,
      conversationId: sessionId,
      processPid: activeSession?.pid,
      claudeHomeDir: sessionSource?.runtimeId === 'claude' ? sessionSource.stateRoot : undefined,
    }).catch(() => null);
    if (activity?.status === 'busy') truth = 'working';
    else if (activity?.status === 'waiting') truth = 'awaiting-input';
    else if (activity?.status === 'idle') truth = 'idle';
  } else if (provider === 'claude' && statusMonitor === 'transcript') {
    const sessionId =
      sessionSource?.runtimeId === 'claude' ? sessionSource.sessionId : conversationId;
    const filePath =
      sessionSource?.runtimeId === 'claude'
        ? await findClaudeTranscriptPathBySessionId(sessionId, sessionSource.stateRoot)
        : cwd
          ? resolveClaudeTranscriptPath(cwd, sessionId)
          : await findClaudeTranscriptPathBySessionId(sessionId);
    if (filePath) {
      const verdict = await readClaudeTurnVerdictFile(filePath).catch(() => null);
      // Deliberately no background-job seed here. Detached jobs are children of
      // the CLI process, so a conversation with no live PTY has none of them
      // left running — which is every conversation a cold load looks at. Parsing
      // this transcript for them would buy a second full scan per conversation
      // to publish zero; the run-state tailer establishes the real count as soon
      // as the session starts or reattaches.
      if (verdict) {
        truth = verdict.state;
        if (
          truth === 'working' &&
          isInterruptedSinceLastPrompt(conversationId, verdict.lastUserAt)
        ) {
          // The transcript's last turn never closed, and an interrupt landed
          // after the prompt that opened it: the turn was cut short, which is a
          // stronger statement than "nothing is running".
          truth = 'interrupted';
        }
      }
    }
  } else if (provider === 'codex' && statusMonitor === 'rollout') {
    const startedAtMs = parseTimestampMs(createdAt);
    const reservedThreadIds = await getReservedCodexThreadIds(conversationId);
    const statePath =
      sessionSource?.runtimeId === 'codex'
        ? resolveCodexStatePath(sessionSource.stateRoot)
        : undefined;
    const threadId = resolveCodexThreadIdForConversation({
      conversationId:
        sessionSource?.runtimeId === 'codex' ? sessionSource.sessionId : conversationId,
      cwd,
      title: title ?? undefined,
      createdAt,
      statePath,
      reservedThreadIds,
    });
    const verdict = await readCodexTurnVerdict(
      conversationId,
      cwd && startedAtMs !== undefined
        ? { cwd, startedAtMs, threadId, statePath }
        : { threadId, statePath }
    ).catch(() => null);
    if (verdict?.state === 'working' || verdict?.state === 'awaiting-input') {
      truth = verdict.state;
      if (isInterruptedSinceLastPrompt(conversationId, verdict.lastStartedAt)) {
        truth = 'interrupted';
      }
    } else if (verdict?.state === 'error') truth = 'error';
    else if (verdict?.state === 'idle') truth = 'idle';
  }

  // The provider-owned truth source is the primary authority: a turn is
  // mid-flight iff the CLI is processing or blocked on the user. This survives
  // a main-process restart / HMR and missed hooks because it is re-derived from
  // the client's selected durable status source.
  //
  // A provider verdict normally stays authoritative across renderer transport
  // attachment. The exception is an ordinary read-only Codex resume with no
  // previously confirmed live turn: an unmatched historical task_started is
  // transcript history, not evidence that this viewing action started work.
  // Surviving tmux reattachments and already-confirmed turns remain authoritative.
  // An `idle` activity/rollout verdict must not erase a more specific terminal
  // status already observed by the live reducer.
  // Codex command approvals are visible immediately in the PTY classifier,
  // while the rollout remains `working` until the command receives an output
  // row. Preserve the live attention state during that short reconciliation
  // window; the rollout tailer emits forced `working` as soon as the approval
  // result arrives.
  let derived =
    runtimeId === 'codex' &&
    statusMonitor === 'rollout' &&
    truth === 'working' &&
    memory === 'awaiting-input'
      ? memory
      : (truth === 'idle' || truth === 'interrupted') &&
          (memory === 'completed' || memory === 'error')
        ? memory
        : (truth ?? memory);
  if (isAgentSessionRunningStatus(derived)) {
    const livePty = hasLivePty(projectId, taskId, conversationId);
    if (truth === undefined && !livePty) derived = 'idle';
    else if (
      runtimeId === 'codex' &&
      statusMonitor === 'rollout' &&
      truth !== undefined &&
      isAgentSessionRunningStatus(truth) &&
      memory === 'idle' &&
      !providerTurnWasConfirmed &&
      (activeSession?.readOnlyResume === true || (mountedTask && !livePty && !activeSession))
    ) {
      // A cold view must not promote an unmatched historical task_started into
      // a live turn. Preserve a status that was already running before the view,
      // and allow the tailer/hook to confirm any event appended after attach.
      derived = 'idle';
    }
  }

  const providerTurnConfirmed =
    isAgentSessionRunningStatus(derived) &&
    truth !== undefined &&
    isAgentSessionRunningStatus(truth);

  // Self-heal the in-memory cache so other readers and the next cold load agree.
  if (derived !== memory) {
    agentSessionRuntimeStore.setStatus(session, derived, { providerTurnConfirmed });
  } else if (providerTurnConfirmed) {
    // A cold truth-source read can confirm the same optimistic `working` state.
    // Promote the fence even though the status itself did not transition.
    agentSessionRuntimeStore.setProviderTurnConfirmed(session, true);
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

async function loadConversationRows(conversationIds: string[]): Promise<
  Map<
    string,
    {
      runtime: string | null;
      createdAt: string | null;
      title: string | null;
      sessionSource?: AgentSessionSource;
    }
  >
> {
  const rows = await db
    .select({
      id: conversations.id,
      runtime: conversations.runtime,
      createdAt: conversations.createdAt,
      title: conversations.title,
      config: conversations.config,
    })
    .from(conversations)
    .where(
      conversationIds.length === 1
        ? eq(conversations.id, conversationIds[0])
        : inArray(conversations.id, conversationIds)
    );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        runtime: r.runtime,
        createdAt: r.createdAt,
        title: r.title,
        sessionSource: parseConversationSessionSource(r.config),
      },
    ])
  );
}
