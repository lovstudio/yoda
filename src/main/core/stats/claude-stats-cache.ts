import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  addTokenBuckets,
  emptyTokenBuckets,
  type DailyTokenUsage,
  type TokenBuckets,
} from '@shared/stats';
import { log } from '@main/lib/logger';

export type ClaudeHistoricalUsage = {
  tokens: TokenBuckets;
  cacheThroughDate: string;
  firstSessionDate: string | null;
  sessionCount: number | null;
};

type ClaudeStatsCache = {
  firstSessionDate?: unknown;
  lastComputedDate?: unknown;
  totalSessions?: unknown;
  modelUsage?: unknown;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseClaudeStatsCache(raw: string): ClaudeHistoricalUsage | null {
  let cache: ClaudeStatsCache;
  try {
    cache = JSON.parse(raw) as ClaudeStatsCache;
  } catch {
    return null;
  }

  const cacheThroughDate =
    typeof cache.lastComputedDate === 'string' && DATE_KEY.test(cache.lastComputedDate)
      ? cache.lastComputedDate
      : null;
  const modelUsage = objectValue(cache.modelUsage);
  if (!cacheThroughDate || !modelUsage) return null;

  const tokens = emptyTokenBuckets();
  for (const value of Object.values(modelUsage)) {
    const model = objectValue(value);
    if (!model) continue;
    addTokenBuckets(tokens, {
      input: finiteNumber(model.inputTokens),
      output: finiteNumber(model.outputTokens),
      cacheRead: finiteNumber(model.cacheReadInputTokens),
      cacheCreation: finiteNumber(model.cacheCreationInputTokens),
      reasoning: 0,
      total:
        finiteNumber(model.inputTokens) +
        finiteNumber(model.outputTokens) +
        finiteNumber(model.cacheReadInputTokens) +
        finiteNumber(model.cacheCreationInputTokens),
    });
  }

  return {
    tokens,
    cacheThroughDate,
    firstSessionDate: typeof cache.firstSessionDate === 'string' ? cache.firstSessionDate : null,
    sessionCount:
      typeof cache.totalSessions === 'number' && Number.isFinite(cache.totalSessions)
        ? cache.totalSessions
        : null,
  };
}

export async function readClaudeStatsCache(
  homeDirectory = homedir()
): Promise<ClaudeHistoricalUsage | null> {
  const cachePath = join(homeDirectory, '.claude', 'stats-cache.json');
  try {
    return parseClaudeStatsCache(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.debug('stats: failed to read Claude stats cache', {
        cachePath,
        error: String(error),
      });
    }
    return null;
  }
}

export function mergeClaudeHistoricalUsage(
  historical: ClaudeHistoricalUsage,
  trackedDaily: readonly DailyTokenUsage[]
): { tokens: TokenBuckets; recentTrackedTokens: TokenBuckets } {
  const tokens = { ...historical.tokens };
  const recentTrackedTokens = emptyTokenBuckets();
  for (const day of trackedDaily) {
    if (day.date <= historical.cacheThroughDate) continue;
    addTokenBuckets(recentTrackedTokens, day.tokens);
  }
  addTokenBuckets(tokens, recentTrackedTokens);
  return { tokens, recentTrackedTokens };
}
