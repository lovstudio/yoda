import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionContextUsage } from '@shared/stats';
import { findClaudeTranscriptPathBySessionId } from '@main/core/conversations/claude-transcript-locator';
import {
  resolveClaudeTranscriptPath,
  resolveClaudeTranscriptPathFromConfigDir,
} from '@main/core/session-title/claude-title-source';
import { iterateLines } from '@main/utils/text-lines';
import { resolveClaudeContextWindow } from './claude-context-window';
import { listClaudeSessionTranscriptPaths } from './claude-session-files';
import {
  aggregateUsageEntries,
  makeUsageEntry,
  type SessionTokenUsage,
  type TranscriptUsageReader,
  type UsageEntry,
} from './types';

/**
 * Token usage from a Claude Code transcript. Assistant rows carry
 * `message.usage` with `input_tokens` (non-cached), `output_tokens`,
 * `cache_read_input_tokens`, `cache_creation_input_tokens`. Claude writes one
 * row per content block, repeating the same `message.id` + usage — dedupe by
 * message id (last row wins, usage is cumulative per message).
 *
 * Subagent (Task tool) burn lives in separate transcripts under
 * `<projectDir>/<sessionId>/subagents/*.jsonl` — real cost, included.
 * Verified against local data: their message ids never overlap the parent
 * file, so per-file message-id dedupe stays sufficient (ccusage parity).
 *
 * Live context usage is derived rather than read: the newest main-thread
 * assistant message carries the whole prompt it just ran on, and
 * `compact_boundary` rows mark each reset. See `claude-context-window.ts` for
 * where the window size comes from.
 */
export const claudeUsageReader: TranscriptUsageReader = {
  resolveTranscriptPaths: async ({ cwd, conversationId, providerSessionId, providerStateRoot }) => {
    // The cwd-derived slug is the fast path, but it misses when the session
    // ran under a since-removed worktree (auto-merge prunes the worktree while
    // the task stays active). Fall back to locating the transcript by id.
    const sessionId = providerSessionId ?? conversationId;
    const main = providerStateRoot
      ? resolveClaudeTranscriptPathFromConfigDir(cwd, sessionId, providerStateRoot)
      : resolveClaudeTranscriptPath(cwd, sessionId);
    if (await exists(main)) return listClaudeSessionTranscriptPaths(dirname(main), sessionId);
    const located = await findClaudeTranscriptPathBySessionId(sessionId, providerStateRoot);
    return located ? listClaudeSessionTranscriptPaths(dirname(located), sessionId) : [];
  },
  parseUsage: parseClaudeUsage,
  parseUsageLines: parseClaudeUsageLines,
};

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function parseClaudeUsage(raw: string): SessionTokenUsage | null {
  const state = createClaudeUsageState();
  for (const line of iterateLines(raw)) {
    consumeClaudeUsageLine(state, line);
  }
  return finishClaudeUsage(state);
}

export async function parseClaudeUsageLines(
  lines: Iterable<string> | AsyncIterable<string>
): Promise<SessionTokenUsage | null> {
  const state = createClaudeUsageState();
  for await (const line of lines) consumeClaudeUsageLine(state, line);
  return finishClaudeUsage(state);
}

type ClaudeContextState = {
  usedTokens: number;
  /** High-water mark, including pre-compaction sizes — this sizes the window. */
  peakTokens: number;
  model: string | null;
  resetCount: number;
  lastResetAt: string | null;
};

type ClaudeUsageState = {
  byMessage: Map<string, UsageEntry>;
  fallbackIndex: number;
  context: ClaudeContextState | null;
};

function createClaudeUsageState(): ClaudeUsageState {
  return { byMessage: new Map(), fallbackIndex: 0, context: null };
}

function consumeClaudeUsageLine(state: ClaudeUsageState, line: string): void {
  // Cheap pre-filter — most rows (user, tool_result, attachments) carry neither.
  if (!line) return;
  const maybeUsage = line.includes('"usage"');
  const maybeBoundary = line.includes('"compact_boundary"');
  if (!maybeUsage && !maybeBoundary) return;
  const row = safeParse(line);
  if (!row) return;
  if (maybeBoundary && consumeCompactBoundary(state, row)) return;
  if (!maybeUsage || row.type !== 'assistant') return;
  const message = objectValue(row.message);
  const usage = objectValue(message?.usage);
  if (!usage) return;

  const messageId = stringValue(message?.id) ?? `row-${state.fallbackIndex++}`;
  // `<synthetic>` marks locally-generated rows with no real model (ccusage parity).
  const model = stringValue(message?.model);
  const buckets = {
    input: numberValue(usage.input_tokens),
    output: numberValue(usage.output_tokens),
    cacheRead: numberValue(usage.cache_read_input_tokens),
    cacheCreation: numberValue(usage.cache_creation_input_tokens),
    reasoning: 0,
  };
  state.byMessage.set(
    messageId,
    makeUsageEntry(buckets, stringValue(row.timestamp), model === '<synthetic>' ? null : model)
  );

  // Subagent turns run on their own window — they must not overwrite the main
  // thread's context reading.
  if (row.isSidechain === true) return;
  const usedTokens = buckets.input + buckets.cacheCreation + buckets.cacheRead + buckets.output;
  state.context = {
    usedTokens,
    peakTokens: Math.max(state.context?.peakTokens ?? 0, usedTokens),
    model: model && model !== '<synthetic>' ? model : (state.context?.model ?? null),
    resetCount: state.context?.resetCount ?? 0,
    lastResetAt: state.context?.lastResetAt ?? null,
  };
}

/** True when the row was a compaction marker, whatever it told us. */
function consumeCompactBoundary(state: ClaudeUsageState, row: Record<string, unknown>): boolean {
  if (row.subtype !== 'compact_boundary') return false;
  const metadata = objectValue(row.compactMetadata);
  const postTokens = numberValue(metadata?.postTokens);
  state.context = {
    // The summary is the whole context now; keep the last reading if the row
    // omitted its size, the next assistant message will correct it.
    usedTokens: postTokens > 0 ? postTokens : (state.context?.usedTokens ?? 0),
    peakTokens: Math.max(state.context?.peakTokens ?? 0, numberValue(metadata?.preTokens)),
    model: state.context?.model ?? null,
    resetCount: (state.context?.resetCount ?? 0) + 1,
    lastResetAt: stringValue(row.timestamp) ?? state.context?.lastResetAt ?? null,
  };
  return true;
}

function finishClaudeUsage(state: ClaudeUsageState): SessionTokenUsage | null {
  const usage = aggregateUsageEntries(state.byMessage.values());
  return usage ? { ...usage, context: resolveContextUsage(state.context) } : null;
}

function resolveContextUsage(context: ClaudeContextState | null): SessionContextUsage | null {
  if (!context || context.usedTokens <= 0) return null;
  return {
    usedTokens: context.usedTokens,
    limitTokens: resolveClaudeContextWindow(context.model, context.peakTokens),
    resetCount: context.resetCount,
    lastResetAt: context.lastResetAt,
    // Claude transcripts carry no rate-limit snapshots.
    rateLimits: [],
  };
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
