import { resolveCodexThreadForConversation } from '@main/core/conversations/codex-session-id';
import {
  readCodexThreadRolloutPath,
  resolveCodexStatePath,
} from '@main/core/session-title/codex-title-source';
import { iterateLines } from '@main/utils/text-lines';
import {
  aggregateUsageEntries,
  makeUsageEntry,
  type SessionTokenUsage,
  type TranscriptUsageReader,
  type UsageEntry,
} from './types';

/**
 * Token usage from a Codex rollout. `token_count` events carry
 * `info.total_token_usage` (cumulative for the session) — we diff consecutive
 * events so repeated mid-turn updates never double-count, and each delta is
 * attributed to its event's timestamp for daily bucketing. Codex's
 * `input_tokens` includes `cached_input_tokens`; normalize so `input` is the
 * non-cached share (matching the Claude reader).
 *
 * Path resolution deliberately uses ONLY the state DB — the rollout-scan
 * fallback used by session context reads and parses every file under
 * `~/.codex/sessions` (hundreds), which is far too expensive when iterating
 * all conversations for usage rollups. Unresolved threads count as zero.
 */
export const codexUsageReader: TranscriptUsageReader = {
  resolveTranscriptPaths: ({ cwd, conversationId, conversationTitle, conversationCreatedAt }) => {
    const statePath = resolveCodexStatePath();
    const thread = resolveCodexThreadForConversation({
      conversationId,
      cwd,
      title: conversationTitle,
      createdAt: conversationCreatedAt,
      statePath,
    });
    if (!thread) return Promise.resolve([]);
    const path = readCodexThreadRolloutPath(statePath, thread.id);
    return Promise.resolve(path ? [path] : []);
  },
  parseUsage: parseCodexUsage,
};

type CumulativeUsage = {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
};

export function parseCodexUsage(raw: string): SessionTokenUsage | null {
  const entries: UsageEntry[] = [];
  let previous: CumulativeUsage = { input: 0, cached: 0, output: 0, reasoning: 0 };
  // Rollouts carry the active model on `turn_context` rows; each token_count
  // delta is attributed to the most recent one (ccusage parity).
  let currentModel: string | null = null;

  for (const line of iterateLines(raw)) {
    // Cheap pre-filter — rollouts are dominated by response_item rows.
    if (!line) continue;
    const isTokenCount = line.includes('"token_count"');
    if (!isTokenCount && !line.includes('"turn_context"')) continue;
    const row = safeParse(line);
    if (!row) continue;
    if (row.type === 'turn_context') {
      currentModel = stringValue(objectValue(row.payload)?.model) ?? currentModel;
      continue;
    }
    if (!isTokenCount || row.type !== 'event_msg') continue;
    const payload = objectValue(row.payload);
    if (payload?.type !== 'token_count') continue;
    const total = objectValue(objectValue(payload.info)?.total_token_usage);
    if (!total) continue;

    const current: CumulativeUsage = {
      input: numberValue(total.input_tokens),
      cached: numberValue(total.cached_input_tokens),
      output: numberValue(total.output_tokens),
      reasoning: numberValue(total.reasoning_output_tokens),
    };
    const delta = diffCumulative(previous, current);
    previous = current;
    if (!delta) continue;

    entries.push(
      makeUsageEntry(
        {
          input: Math.max(0, delta.input - delta.cached),
          output: delta.output,
          cacheRead: delta.cached,
          cacheCreation: 0,
          reasoning: delta.reasoning,
        },
        stringValue(row.timestamp),
        currentModel
      )
    );
  }

  return aggregateUsageEntries(entries);
}

/**
 * Null when nothing changed since the previous event. A shrinking counter
 * (compaction / fresh session segment) resets the baseline: count the new
 * cumulative value in full rather than producing negative deltas.
 */
function diffCumulative(
  previous: CumulativeUsage,
  current: CumulativeUsage
): CumulativeUsage | null {
  const reset = current.input < previous.input || current.output < previous.output;
  const base = reset ? { input: 0, cached: 0, output: 0, reasoning: 0 } : previous;
  const delta: CumulativeUsage = {
    input: Math.max(0, current.input - base.input),
    cached: Math.max(0, current.cached - base.cached),
    output: Math.max(0, current.output - base.output),
    reasoning: Math.max(0, current.reasoning - base.reasoning),
  };
  if (delta.input === 0 && delta.output === 0) return null;
  return delta;
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
