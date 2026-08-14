import type { MaasPlatformId, MaasUsageSummary } from '@shared/maas';

export type NewApiStatusResponse = {
  success?: boolean;
  data?: {
    quota_per_unit?: number;
    quota_display_type?: string;
  };
  message?: string;
};

export type NewApiTokenUsageResponse = {
  code?: boolean;
  object?: string;
  data?: {
    name?: string;
    usage?: number;
    remain?: number;
    total_granted?: number;
    total_used?: number;
    total_available?: number;
    accessed_at?: number;
    expired_at?: number;
  };
  error?: string | { message?: string };
  message?: string;
};

type NewApiUsageResource = 'status' | 'token';

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function errorMessage(body: NewApiTokenUsageResponse | null, fallback: string): string {
  if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  if (
    typeof body?.error === 'object' &&
    typeof body.error.message === 'string' &&
    body.error.message.trim()
  ) {
    return body.error.message.trim();
  }
  if (typeof body?.message === 'string' && body.message.trim()) return body.message.trim();
  return fallback;
}

export function newApiUsageUrl(endpoint: string, resource: NewApiUsageResource): URL {
  const path = resource === 'status' ? '/api/status' : '/api/usage/token/';
  return new URL(path, endpoint.trim());
}

export function getNewApiQuotaPerUnit(response: NewApiStatusResponse): number | null {
  if (response.success !== true) return null;
  const quotaPerUnit = nullableFiniteNumber(response.data?.quota_per_unit);
  if (quotaPerUnit == null || quotaPerUnit <= 0) return null;

  const displayType = response.data?.quota_display_type?.trim().toUpperCase();
  return !displayType || displayType === 'USD' ? quotaPerUnit : null;
}

export function buildNewApiUsageSummary(
  platformId: MaasPlatformId,
  response: NewApiTokenUsageResponse,
  quotaPerUnit: number,
  fetchedAt: string
): MaasUsageSummary {
  const grantedQuota = nullableFiniteNumber(response.data?.total_granted);
  const availableQuota =
    nullableFiniteNumber(response.data?.total_available) ??
    nullableFiniteNumber(response.data?.remain);
  const usedQuota =
    nullableFiniteNumber(response.data?.total_used) ??
    nullableFiniteNumber(response.data?.usage) ??
    (grantedQuota != null && availableQuota != null ? grantedQuota - availableQuota : null);
  const totalQuota =
    grantedQuota ??
    (usedQuota != null && availableQuota != null ? usedQuota + availableQuota : null);

  if (usedQuota == null && availableQuota == null && totalQuota == null) {
    throw new Error('New API token usage did not return quota values.');
  }

  return {
    platformId,
    recordCount: 0,
    totalRecords: 0,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalCostUsd: usedQuota == null ? null : usedQuota / quotaPerUnit,
    totalCreditsUsd: totalQuota == null ? null : totalQuota / quotaPerUnit,
    remainingCreditsUsd: availableQuota == null ? null : availableQuota / quotaPerUnit,
    keyLimitUsd: null,
    keyLimitRemainingUsd: null,
    usageDailyUsd: null,
    usageWeeklyUsd: null,
    usageMonthlyUsd: null,
    source: 'new-api-token',
    fetchedAt,
    period: null,
  };
}

export async function fetchNewApiUsageSummary({
  endpoint,
  apiKey,
  platformId,
  fetchedAt = new Date().toISOString(),
  fetchImpl = fetch,
}: {
  endpoint: string;
  apiKey: string;
  platformId: MaasPlatformId;
  fetchedAt?: string;
  fetchImpl?: typeof fetch;
}): Promise<MaasUsageSummary | null> {
  let statusResponse: Response;
  try {
    statusResponse = await fetchImpl(newApiUsageUrl(endpoint, 'status'));
  } catch {
    return null;
  }

  let statusBody: NewApiStatusResponse | null = null;
  try {
    statusBody = (await statusResponse.json()) as NewApiStatusResponse;
  } catch {
    statusBody = null;
  }

  const quotaPerUnit = statusResponse.ok && statusBody ? getNewApiQuotaPerUnit(statusBody) : null;
  if (quotaPerUnit == null) return null;
  if (!apiKey.trim()) {
    throw new Error('New API inference API key is missing. Reconnect this Profile to read usage.');
  }

  const response = await fetchImpl(newApiUsageUrl(endpoint, 'token'), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  let body: NewApiTokenUsageResponse | null = null;
  try {
    body = (await response.json()) as NewApiTokenUsageResponse;
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(
      `New API token usage returned ${response.status}: ${errorMessage(
        body,
        response.statusText || 'Request failed.'
      )}`
    );
  }
  if (body?.code === false) {
    throw new Error(errorMessage(body, 'New API token usage rejected the request.'));
  }
  if (!body?.data) {
    throw new Error('New API token usage did not return a token payload.');
  }

  return buildNewApiUsageSummary(platformId, body, quotaPerUnit, fetchedAt);
}
