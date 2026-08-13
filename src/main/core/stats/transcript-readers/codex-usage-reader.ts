import type { SessionContextUsage, SessionRateLimit } from '@shared/stats';
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
  resolveTranscriptPaths: ({
    cwd,
    conversationId,
    conversationTitle,
    conversationCreatedAt,
    providerSessionId,
    providerStateRoot,
  }) => {
    const statePath = resolveCodexStatePath(providerStateRoot);
    if (providerSessionId) {
      const path = readCodexThreadRolloutPath(statePath, providerSessionId);
      return Promise.resolve(path ? [path] : []);
    }
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
  parseUsageLines: parseCodexUsageLines,
};

type CumulativeUsage = {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
};

export function parseCodexUsage(raw: string): SessionTokenUsage | null {
  const state = createCodexUsageState();
  for (const line of iterateLines(raw)) consumeCodexUsageLine(state, line);
  return finishCodexUsage(state);
}

export async function parseCodexUsageLines(
  lines: Iterable<string> | AsyncIterable<string>
): Promise<SessionTokenUsage | null> {
  const state = createCodexUsageState();
  for await (const line of lines) consumeCodexUsageLine(state, line);
  return finishCodexUsage(state);
}

type CodexUsageState = {
  entries: UsageEntry[];
  previous: CumulativeUsage;
  context: SessionContextUsage | null;
  currentModel: string | null;
};

function createCodexUsageState(): CodexUsageState {
  return {
    entries: [],
    previous: { input: 0, cached: 0, output: 0, reasoning: 0 },
    context: null,
    currentModel: null,
  };
}

function consumeCodexUsageLine(state: CodexUsageState, line: string): void {
  // Cheap pre-filter — rollouts are dominated by response_item rows.
  if (!line) return;
  const isTokenCount = line.includes('"token_count"');
  if (!isTokenCount && !line.includes('"turn_context"')) return;
  const row = safeParse(line);
  if (!row) return;
  if (row.type === 'turn_context') {
    state.currentModel = stringValue(objectValue(row.payload)?.model) ?? state.currentModel;
    return;
  }
  if (!isTokenCount || row.type !== 'event_msg') return;
  const payload = objectValue(row.payload);
  if (payload?.type !== 'token_count') return;
  const total = objectValue(objectValue(payload.info)?.total_token_usage);
  if (!total) return;

  const nextContext = readContextUsage(payload, stringValue(row.timestamp), state.context);
  if (nextContext) state.context = nextContext;

  const current: CumulativeUsage = {
    input: numberValue(total.input_tokens),
    cached: numberValue(total.cached_input_tokens),
    output: numberValue(total.output_tokens),
    reasoning: numberValue(total.reasoning_output_tokens),
  };
  const delta = diffCumulative(state.previous, current);
  state.previous = current;
  if (!delta) return;

  state.entries.push(
    makeUsageEntry(
      {
        input: Math.max(0, delta.input - delta.cached),
        output: delta.output,
        cacheRead: delta.cached,
        cacheCreation: 0,
        reasoning: delta.reasoning,
      },
      stringValue(row.timestamp),
      state.currentModel
    )
  );
}

function finishCodexUsage(state: CodexUsageState): SessionTokenUsage | null {
  const usage = aggregateUsageEntries(state.entries);
  return usage ? { ...usage, context: state.context } : null;
}

function readContextUsage(
  payload: Record<string, unknown>,
  timestamp: string | null,
  previousContext: SessionContextUsage | null
): SessionContextUsage | null {
  const info = objectValue(payload.info);
  const last = objectValue(info?.last_token_usage);
  const limitTokens = numberValue(info?.model_context_window);
  if (!last || limitTokens <= 0) return null;

  const usedTokens = numberValue(last.total_tokens);
  if (usedTokens <= 0) return null;
  const reset = previousContext != null && usedTokens < previousContext.usedTokens;
  return {
    usedTokens,
    limitTokens,
    resetCount: (previousContext?.resetCount ?? 0) + Number(reset),
    lastResetAt: reset ? timestamp : (previousContext?.lastResetAt ?? null),
    rateLimits: readRateLimits(objectValue(payload.rate_limits)),
  };
}

function readRateLimits(value: Record<string, unknown> | null): SessionRateLimit[] {
  if (!value) return [];
  return [value.primary, value.secondary]
    .map((item) => objectValue(item))
    .flatMap((item): SessionRateLimit[] => {
      if (!item) return [];
      const windowMinutes = numberValue(item.window_minutes);
      const usedPercent = numberValue(item.used_percent);
      if (windowMinutes <= 0 || usedPercent < 0) return [];
      const resetsAtSeconds = numberValue(item.resets_at);
      return [
        {
          windowMinutes,
          usedPercent,
          resetsAt: resetsAtSeconds > 0 ? new Date(resetsAtSeconds * 1000).toISOString() : null,
        },
      ];
    });
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
