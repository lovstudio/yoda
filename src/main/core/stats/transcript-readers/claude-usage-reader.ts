import { dirname } from 'node:path';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
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
  resolveTranscriptPaths: ({ cwd, conversationId }) => {
    const main = resolveClaudeTranscriptPath(cwd, conversationId);
    return listClaudeSessionTranscriptPaths(dirname(main), conversationId);
  },
  parseUsage: parseClaudeUsage,
};

export function parseClaudeUsage(raw: string): SessionTokenUsage | null {
  const byMessage = new Map<string, UsageEntry>();
  let fallbackIndex = 0;

  for (const line of iterateLines(raw)) {
    // Cheap pre-filter — most rows (user, tool_result, attachments) have no usage.
    if (!line || !line.includes('"usage"')) continue;
    const row = safeParse(line);
    if (!row || row.type !== 'assistant') continue;
    const message = objectValue(row.message);
    const usage = objectValue(message?.usage);
    if (!usage) continue;

    const messageId = stringValue(message?.id) ?? `row-${fallbackIndex++}`;
    // `<synthetic>` marks locally-generated rows with no real model (ccusage parity).
    const model = stringValue(message?.model);
    byMessage.set(
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

  return aggregateUsageEntries(byMessage.values());
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
