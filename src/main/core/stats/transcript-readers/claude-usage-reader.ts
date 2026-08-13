import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { findClaudeTranscriptPathBySessionId } from '@main/core/conversations/claude-transcript-locator';
import {
  resolveClaudeTranscriptPath,
  resolveClaudeTranscriptPathFromConfigDir,
} from '@main/core/session-title/claude-title-source';
import { iterateLines } from '@main/utils/text-lines';
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
  return aggregateUsageEntries(state.byMessage.values());
}

export async function parseClaudeUsageLines(
  lines: Iterable<string> | AsyncIterable<string>
): Promise<SessionTokenUsage | null> {
  const state = createClaudeUsageState();
  for await (const line of lines) consumeClaudeUsageLine(state, line);
  return aggregateUsageEntries(state.byMessage.values());
}

type ClaudeUsageState = {
  byMessage: Map<string, UsageEntry>;
  fallbackIndex: number;
};

function createClaudeUsageState(): ClaudeUsageState {
  return { byMessage: new Map(), fallbackIndex: 0 };
}

function consumeClaudeUsageLine(state: ClaudeUsageState, line: string): void {
  // Cheap pre-filter — most rows (user, tool_result, attachments) have no usage.
  if (!line || !line.includes('"usage"')) return;
  const row = safeParse(line);
  if (!row || row.type !== 'assistant') return;
  const message = objectValue(row.message);
  const usage = objectValue(message?.usage);
  if (!usage) return;

  const messageId = stringValue(message?.id) ?? `row-${state.fallbackIndex++}`;
  // `<synthetic>` marks locally-generated rows with no real model (ccusage parity).
  const model = stringValue(message?.model);
  state.byMessage.set(
    messageId,
    makeUsageEntry(
      {
        input: numberValue(usage.input_tokens),
        output: numberValue(usage.output_tokens),
        cacheRead: numberValue(usage.cache_read_input_tokens),
        cacheCreation: numberValue(usage.cache_creation_input_tokens),
        reasoning: 0,
      },
      stringValue(row.timestamp),
      model === '<synthetic>' ? null : model
    )
  );
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
