import type { Conversation } from '@shared/conversations';
import {
  findClosestCodexThreadRefByCreatedAt,
  findClosestCodexThreadRefByTitleAndCreatedAt,
  findCodexThreadTitleByTitle,
  findUniqueCodexThreadRefByCreatedAt,
  findUniqueCodexThreadRefByCwdAtActivity,
  findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt,
  getClaimedCodexThreadId,
  readCodexThreadRef,
  resolveCodexStatePath,
  type CodexThreadRef,
} from '@main/core/session-title/codex-title-source';
import { resolveLatestCodexThreadIdInLineage } from './codex-thread-lineage';
import { getConversationAgentSessionId } from './conversation-session-source';

const SQLITE_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS = 2 * 60_000;
const CODEX_MOVED_CWD_CREATED_AT_MATCH_MAX_DISTANCE_MS = 10_000;

export type AgentResumeSession = {
  sessionId: string;
  sessionTitle?: string;
};

type ResolvedCodexThread = {
  id: string;
  title?: string;
};

export function resolveAgentResumeSession(
  conversation: Conversation,
  cwd?: string,
  options: { reservedThreadIds?: ReadonlySet<string> } = {}
): AgentResumeSession {
  if (conversation.runtimeId !== 'codex') {
    return {
      sessionId: getConversationAgentSessionId(conversation),
      sessionTitle: conversation.title,
    };
  }

  if (conversation.sessionSource?.runtimeId === 'codex') {
    const source = conversation.sessionSource;
    const thread = resolveCodexThreadForConversation({
      conversationId: source.sessionId,
      cwd,
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastInteractedAt: conversation.lastInteractedAt,
      statePath: resolveCodexStatePath(source.stateRoot),
      reservedThreadIds: options.reservedThreadIds,
    });
    return {
      sessionId: thread?.id ?? source.sessionId,
      sessionTitle: thread?.title ?? conversation.title,
    };
  }

  const thread = resolveCodexThreadForConversation({
    conversationId: conversation.id,
    cwd,
    title: conversation.title,
    createdAt: conversation.createdAt,
    lastInteractedAt: conversation.lastInteractedAt,
    reservedThreadIds: options.reservedThreadIds,
  });
  return {
    sessionId: thread?.id ?? conversation.id,
    sessionTitle: thread?.title ?? conversation.title,
  };
}

export function resolveAgentResumeSessionId(
  conversation: Conversation,
  cwd?: string,
  options: { reservedThreadIds?: ReadonlySet<string> } = {}
): string {
  return resolveAgentResumeSession(conversation, cwd, options).sessionId;
}

export function resolveCodexThreadIdForConversation({
  conversationId,
  cwd,
  title,
  createdAt,
  lastInteractedAt,
  statePath = resolveCodexStatePath(),
  reservedThreadIds,
}: {
  conversationId: string;
  cwd?: string;
  title?: string;
  createdAt?: string | null;
  lastInteractedAt?: string | null;
  statePath?: string;
  reservedThreadIds?: ReadonlySet<string>;
}): string | undefined {
  return resolveCodexThreadForConversation({
    conversationId,
    cwd,
    title,
    createdAt,
    lastInteractedAt,
    statePath,
    reservedThreadIds,
  })?.id;
}

export function resolveCodexThreadForConversation({
  conversationId,
  cwd,
  title,
  createdAt,
  lastInteractedAt,
  statePath = resolveCodexStatePath(),
  reservedThreadIds,
}: {
  conversationId: string;
  cwd?: string;
  title?: string;
  createdAt?: string | null;
  lastInteractedAt?: string | null;
  statePath?: string;
  reservedThreadIds?: ReadonlySet<string>;
}): ResolvedCodexThread | undefined {
  const resolveCurrent = (thread: CodexThreadRef | undefined, fallbackId?: string) =>
    toCurrentResolvedThread(statePath, thread, fallbackId, reservedThreadIds);
  const claimedThreadId = getClaimedCodexThreadId(conversationId);
  if (claimedThreadId)
    return resolveCurrent(readCodexThreadRef(statePath, claimedThreadId), claimedThreadId);

  const direct = readCodexThreadRef(statePath, conversationId);
  if (direct) return resolveCurrent(direct, conversationId);

  const trimmedCwd = cwd?.trim();
  if (!trimmedCwd) return undefined;

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    const byTitle = findCodexThreadTitleByTitle({
      statePath,
      cwd: trimmedCwd,
      title: trimmedTitle,
      includeArchived: true,
    });
    if (byTitle) return resolveCurrent(byTitle);
  }

  const lastInteractedAtMs = parseTimestampMs(lastInteractedAt);
  if (lastInteractedAtMs !== undefined) {
    const byActivity = findUniqueCodexThreadRefByCwdAtActivity({
      statePath,
      cwd: trimmedCwd,
      activityAtMs: lastInteractedAtMs,
      includeArchived: true,
    });
    if (byActivity) return resolveCurrent(byActivity);
  }

  const createdAtMs = parseTimestampMs(createdAt);
  if (createdAtMs === undefined) return undefined;

  const byCreatedAt = findClosestCodexThreadRefByCreatedAt({
    statePath,
    cwd: trimmedCwd,
    targetCreatedAtMs: createdAtMs,
    maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
    includeArchived: true,
  });
  if (byCreatedAt) return resolveCurrent(byCreatedAt);

  if (trimmedTitle) {
    const byMovedPathTitle = findClosestCodexThreadRefByTitleAndCreatedAt({
      statePath,
      title: trimmedTitle,
      targetCreatedAtMs: createdAtMs,
      maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
      includeArchived: true,
    });
    if (byMovedPathTitle) return resolveCurrent(byMovedPathTitle);
  }

  const byMovedPathCreatedAt = findUniqueCodexThreadRefByCreatedAt({
    statePath,
    targetCreatedAtMs: createdAtMs,
    maxDistanceMs: CODEX_MOVED_CWD_CREATED_AT_MATCH_MAX_DISTANCE_MS,
    includeArchived: true,
  });
  if (byMovedPathCreatedAt) return resolveCurrent(byMovedPathCreatedAt);

  const uniqueLaterThread = findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt({
    statePath,
    cwd: trimmedCwd,
    minCreatedAtMs: createdAtMs,
    includeArchived: true,
  });
  return resolveCurrent(uniqueLaterThread);
}

function toCurrentResolvedThread(
  statePath: string,
  thread: CodexThreadRef | undefined,
  fallbackId?: string,
  reservedThreadIds?: ReadonlySet<string>
): ResolvedCodexThread | undefined {
  const resolved = toResolvedThread(thread, fallbackId);
  if (!resolved || !thread) return resolved;
  const currentThreadId = resolveLatestCodexThreadIdInLineage({
    statePath,
    rootThreadId: thread.id,
    reservedThreadIds,
  });
  if (currentThreadId === thread.id) return resolved;
  return toResolvedThread(readCodexThreadRef(statePath, currentThreadId), currentThreadId);
}

function toResolvedThread(
  thread: CodexThreadRef | undefined,
  fallbackId?: string
): ResolvedCodexThread | undefined {
  if (thread) return { id: thread.id, title: thread.title };
  return fallbackId ? { id: fallbackId } : undefined;
}

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = SQLITE_TIMESTAMP_RE.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}
