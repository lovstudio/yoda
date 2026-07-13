import type { Conversation } from '@shared/conversations';
import {
  findClosestCodexThreadRefByCreatedAt,
  findClosestCodexThreadRefByTitleAndCreatedAt,
  findCodexThreadTitleByTitle,
  findUniqueCodexThreadRefByCreatedAt,
  findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt,
  getClaimedCodexThreadId,
  readCodexThreadRef,
  resolveCodexStatePath,
  type CodexThreadRef,
} from '@main/core/session-title/codex-title-source';

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
  cwd?: string
): AgentResumeSession {
  if (conversation.runtimeId !== 'codex') {
    return { sessionId: conversation.id, sessionTitle: conversation.title };
  }

  const thread = resolveCodexThreadForConversation({
    conversationId: conversation.id,
    cwd,
    title: conversation.title,
    createdAt: conversation.createdAt,
  });
  return {
    sessionId: thread?.id ?? conversation.id,
    sessionTitle: thread?.title ?? conversation.title,
  };
}

export function resolveAgentResumeSessionId(conversation: Conversation, cwd?: string): string {
  return resolveAgentResumeSession(conversation, cwd).sessionId;
}

export function resolveCodexThreadIdForConversation({
  conversationId,
  cwd,
  title,
  createdAt,
  statePath = resolveCodexStatePath(),
}: {
  conversationId: string;
  cwd?: string;
  title?: string;
  createdAt?: string | null;
  statePath?: string;
}): string | undefined {
  return resolveCodexThreadForConversation({
    conversationId,
    cwd,
    title,
    createdAt,
    statePath,
  })?.id;
}

export function resolveCodexThreadForConversation({
  conversationId,
  cwd,
  title,
  createdAt,
  statePath = resolveCodexStatePath(),
}: {
  conversationId: string;
  cwd?: string;
  title?: string;
  createdAt?: string | null;
  statePath?: string;
}): ResolvedCodexThread | undefined {
  const claimedThreadId = getClaimedCodexThreadId(conversationId);
  if (claimedThreadId)
    return toResolvedThread(readCodexThreadRef(statePath, claimedThreadId), claimedThreadId);

  const direct = readCodexThreadRef(statePath, conversationId);
  if (direct) return toResolvedThread(direct, conversationId);

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
    if (byTitle) return toResolvedThread(byTitle);
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
  if (byCreatedAt) return toResolvedThread(byCreatedAt);

  if (trimmedTitle) {
    const byMovedPathTitle = findClosestCodexThreadRefByTitleAndCreatedAt({
      statePath,
      title: trimmedTitle,
      targetCreatedAtMs: createdAtMs,
      maxDistanceMs: CODEX_CREATED_AT_MATCH_MAX_DISTANCE_MS,
      includeArchived: true,
    });
    if (byMovedPathTitle) return toResolvedThread(byMovedPathTitle);
  }

  const byMovedPathCreatedAt = findUniqueCodexThreadRefByCreatedAt({
    statePath,
    targetCreatedAtMs: createdAtMs,
    maxDistanceMs: CODEX_MOVED_CWD_CREATED_AT_MATCH_MAX_DISTANCE_MS,
    includeArchived: true,
  });
  if (byMovedPathCreatedAt) return toResolvedThread(byMovedPathCreatedAt);

  const uniqueLaterThread = findUniqueUntitledCodexThreadRefByCwdAfterCreatedAt({
    statePath,
    cwd: trimmedCwd,
    minCreatedAtMs: createdAtMs,
    includeArchived: true,
  });
  return toResolvedThread(uniqueLaterThread);
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
