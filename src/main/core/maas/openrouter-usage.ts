import type { MaasPlatformId, MaasUsageSummary } from '@shared/maas';

export type OpenRouterKeyResponse = {
  data?: {
    limit?: number | null;
    limit_remaining?: number | null;
    usage?: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
  };
  error?: string | { message?: string };
  message?: string;
};

export type OpenRouterCreditsResponse = {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
  error?: string | { message?: string };
  message?: string;
};

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function openRouterUsageUrl(endpoint: string, resource: 'key' | 'credits'): URL {
  const base = `${endpoint.trim().replace(/\/+$/, '')}/`;
  return new URL(resource, base);
}

export function buildOpenRouterUsageSummary(
  platformId: MaasPlatformId,
  keyResponse: OpenRouterKeyResponse,
  creditsResponse: OpenRouterCreditsResponse | null,
  fetchedAt: string
): MaasUsageSummary {
  const totalCreditsUsd = nullableFiniteNumber(creditsResponse?.data?.total_credits);
  const totalCostUsd =
    nullableFiniteNumber(creditsResponse?.data?.total_usage) ??
    nullableFiniteNumber(keyResponse.data?.usage);

  return {
    platformId,
    recordCount: 0,
    totalRecords: 0,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCostUsd,
    totalCreditsUsd,
    remainingCreditsUsd:
      totalCreditsUsd != null && totalCostUsd != null
        ? Math.max(0, totalCreditsUsd - totalCostUsd)
        : null,
    keyLimitUsd: nullableFiniteNumber(keyResponse.data?.limit),
    keyLimitRemainingUsd: nullableFiniteNumber(keyResponse.data?.limit_remaining),
    usageDailyUsd: nullableFiniteNumber(keyResponse.data?.usage_daily),
    usageWeeklyUsd: nullableFiniteNumber(keyResponse.data?.usage_weekly),
    usageMonthlyUsd: nullableFiniteNumber(keyResponse.data?.usage_monthly),
    source: creditsResponse?.data ? 'openrouter-key-and-credits' : 'openrouter-key',
    fetchedAt,
    period: null,
  };
}
