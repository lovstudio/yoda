import { describe, expect, it } from 'vitest';
import { mergeClaudeHistoricalUsage, parseClaudeStatsCache } from './claude-stats-cache';

describe('Claude stats cache', () => {
  it('normalizes the persistent model aggregate into token buckets', () => {
    const parsed = parseClaudeStatsCache(
      JSON.stringify({
        firstSessionDate: '2026-01-02T03:04:05.000Z',
        lastComputedDate: '2026-04-28',
        totalSessions: 12,
        modelUsage: {
          opus: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadInputTokens: 30,
            cacheCreationInputTokens: 40,
          },
          sonnet: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 4,
          },
        },
      })
    );

    expect(parsed).toEqual({
      tokens: {
        input: 11,
        output: 22,
        cacheRead: 33,
        cacheCreation: 44,
        reasoning: 0,
        total: 110,
      },
      cacheThroughDate: '2026-04-28',
      firstSessionDate: '2026-01-02T03:04:05.000Z',
      sessionCount: 12,
    });
  });

  it('adds only tracked daily usage after the cache cutoff', () => {
    const historical = parseClaudeStatsCache(
      JSON.stringify({
        lastComputedDate: '2026-04-28',
        modelUsage: {
          opus: {
            inputTokens: 10,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      })
    );
    expect(historical).not.toBeNull();

    const merged = mergeClaudeHistoricalUsage(historical!, [
      {
        date: '2026-04-28',
        tokens: {
          input: 99,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          reasoning: 0,
          total: 99,
        },
      },
      {
        date: '2026-04-29',
        tokens: {
          input: 2,
          output: 3,
          cacheRead: 5,
          cacheCreation: 7,
          reasoning: 0,
          total: 17,
        },
      },
    ]);

    expect(merged.tokens.total).toBe(27);
    expect(merged.recentTrackedTokens.total).toBe(17);
  });

  it('rejects caches without a trustworthy cutoff', () => {
    expect(parseClaudeStatsCache('{"modelUsage":{}}')).toBeNull();
    expect(parseClaudeStatsCache('not json')).toBeNull();
  });
});
