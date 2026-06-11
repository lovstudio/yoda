import {
  addTokenBuckets,
  emptyTokenBuckets,
  type DailyTokenUsage,
  type TokenBuckets,
} from '@shared/stats';
import { formatLocalDateKey } from '../local-date';

export type ModelTokenUsage = {
  /** Provider-reported model id; null when the rows carried none. */
  model: string | null;
  tokens: TokenBuckets;
};

export type SessionTokenUsage = {
  total: TokenBuckets;
  /** Sorted ascending by date. Entries without a parseable timestamp only count toward `total`. */
  daily: DailyTokenUsage[];
  /** Sorted by total, descending. */
  byModel: ModelTokenUsage[];
};

export type UsageReaderContext = {
  cwd: string;
  conversationId: string;
  conversationTitle?: string;
  conversationCreatedAt?: string | null;
};

export interface TranscriptUsageReader {
  /**
   * Every transcript file belonging to the session (main transcript plus
   * subagent transcripts, if any). Empty when nothing can be located.
   */
  resolveTranscriptPaths(ctx: UsageReaderContext): Promise<string[]>;
  /** Null when the transcript contains no token usage. */
  parseUsage(raw: string): SessionTokenUsage | null;
}

export type UsageEntry = {
  buckets: TokenBuckets;
  timestamp: string | null;
  model: string | null;
};

export function makeUsageEntry(
  fields: Omit<TokenBuckets, 'total'>,
  timestamp: string | null,
  model: string | null
): UsageEntry {
  return {
    buckets: {
      ...fields,
      // All tokens processed; `reasoning` is a subset of `output` and excluded.
      total: fields.input + fields.output + fields.cacheRead + fields.cacheCreation,
    },
    timestamp,
    model,
  };
}

export function aggregateUsageEntries(entries: Iterable<UsageEntry>): SessionTokenUsage | null {
  const total = emptyTokenBuckets();
  const daily = new Map<string, TokenBuckets>();
  const byModel = new Map<string | null, TokenBuckets>();
  let seen = false;
  for (const entry of entries) {
    seen = true;
    addTokenBuckets(total, entry.buckets);
    const modelBucket = byModel.get(entry.model);
    if (modelBucket) addTokenBuckets(modelBucket, entry.buckets);
    else byModel.set(entry.model, { ...entry.buckets });
    const dateKey = toLocalDateKey(entry.timestamp);
    if (!dateKey) continue;
    const bucket = daily.get(dateKey);
    if (bucket) addTokenBuckets(bucket, entry.buckets);
    else daily.set(dateKey, { ...entry.buckets });
  }
  if (!seen) return null;
  return {
    total,
    daily: sortedDaily(daily),
    byModel: sortedByModel(byModel),
  };
}

/** Merge per-file usages (main transcript + subagent transcripts) into one session rollup. */
export function mergeSessionUsages(usages: SessionTokenUsage[]): SessionTokenUsage | null {
  if (usages.length === 0) return null;
  if (usages.length === 1) return usages[0]!;
  const total = emptyTokenBuckets();
  const daily = new Map<string, TokenBuckets>();
  const byModel = new Map<string | null, TokenBuckets>();
  for (const usage of usages) {
    addTokenBuckets(total, usage.total);
    for (const day of usage.daily) {
      const bucket = daily.get(day.date);
      if (bucket) addTokenBuckets(bucket, day.tokens);
      else daily.set(day.date, { ...day.tokens });
    }
    for (const model of usage.byModel) {
      const bucket = byModel.get(model.model);
      if (bucket) addTokenBuckets(bucket, model.tokens);
      else byModel.set(model.model, { ...model.tokens });
    }
  }
  return { total, daily: sortedDaily(daily), byModel: sortedByModel(byModel) };
}

function sortedDaily(daily: Map<string, TokenBuckets>): DailyTokenUsage[] {
  return [...daily.entries()]
    .map(([date, tokens]) => ({ date, tokens }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function sortedByModel(byModel: Map<string | null, TokenBuckets>): ModelTokenUsage[] {
  return [...byModel.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens.total - a.tokens.total);
}

function toLocalDateKey(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return null;
  return formatLocalDateKey(new Date(ms));
}
