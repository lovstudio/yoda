import { describe, expect, it } from 'vitest';
import { buildOpenRouterUsageSummary, openRouterUsageUrl } from './openrouter-usage';

describe('OpenRouter usage', () => {
  it('builds API paths from the configured inference endpoint', () => {
    expect(openRouterUsageUrl('https://openrouter.ai/api/v1/', 'key').toString()).toBe(
      'https://openrouter.ai/api/v1/key'
    );
    expect(openRouterUsageUrl('https://openrouter.ai/api/v1', 'credits').toString()).toBe(
      'https://openrouter.ai/api/v1/credits'
    );
  });

  it('maps the current key and account credits into a provider usage summary', () => {
    expect(
      buildOpenRouterUsageSummary(
        'openrouter',
        {
          data: {
            limit: 25,
            limit_remaining: 7,
            usage: 18,
            usage_daily: 1.25,
            usage_weekly: 7.5,
            usage_monthly: 18,
          },
        },
        { data: { total_credits: 50, total_usage: 18 } },
        '2026-08-14T00:00:00.000Z'
      )
    ).toEqual({
      platformId: 'openrouter',
      recordCount: 0,
      totalRecords: 0,
      totalInputTokens: null,
      totalOutputTokens: null,
      totalCostUsd: 18,
      totalCreditsUsd: 50,
      remainingCreditsUsd: 32,
      keyLimitUsd: 25,
      keyLimitRemainingUsd: 7,
      usageDailyUsd: 1.25,
      usageWeeklyUsd: 7.5,
      usageMonthlyUsd: 18,
      source: 'openrouter-key-and-credits',
      fetchedAt: '2026-08-14T00:00:00.000Z',
      period: null,
    });
  });

  it('keeps key usage available when account credits require a management key', () => {
    expect(
      buildOpenRouterUsageSummary(
        'openrouter',
        {
          data: {
            limit: 25,
            limit_remaining: 7,
            usage: 18,
            usage_daily: 1.25,
            usage_weekly: 7.5,
            usage_monthly: 18,
          },
        },
        null,
        '2026-08-14T00:00:00.000Z'
      )
    ).toMatchObject({
      totalCostUsd: 18,
      totalCreditsUsd: null,
      remainingCreditsUsd: null,
      keyLimitRemainingUsd: 7,
      source: 'openrouter-key',
    });
  });
});
