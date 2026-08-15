import { describe, expect, it, vi } from 'vitest';
import {
  buildNewApiAccountUsageSummary,
  buildNewApiUsageSummary,
  fetchNewApiUsageSummary,
  newApiUsageUrl,
} from './new-api-usage';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('New API usage', () => {
  it('builds management paths from the endpoint origin instead of its inference path', () => {
    expect(newApiUsageUrl('https://newapi.1234bot.com/v1', 'status').toString()).toBe(
      'https://newapi.1234bot.com/api/status'
    );
    expect(newApiUsageUrl('https://newapi.1234bot.com/v1/', 'token').toString()).toBe(
      'https://newapi.1234bot.com/api/usage/token/'
    );
    expect(newApiUsageUrl('https://newapi.1234bot.com/v1/', 'account').toString()).toBe(
      'https://newapi.1234bot.com/api/user/self'
    );
  });

  it('maps the legacy token quota fields used by LovBrowser', () => {
    expect(
      buildNewApiUsageSummary(
        'profile:lovbrowser',
        { data: { usage: 1_500_000, remain: 3_500_000 } },
        500_000,
        '2026-08-14T00:00:00.000Z'
      )
    ).toMatchObject({
      totalCostUsd: 3,
      remainingCreditsUsd: 7,
      totalCreditsUsd: 10,
      source: 'new-api-token',
    });
  });

  it('maps the current New API token quota fields', () => {
    expect(
      buildNewApiUsageSummary(
        'newapi',
        {
          data: {
            total_used: 1_500_000,
            total_available: 3_500_000,
            total_granted: 5_000_000,
          },
        },
        500_000,
        '2026-08-14T00:00:00.000Z'
      )
    ).toMatchObject({
      totalCostUsd: 3,
      remainingCreditsUsd: 7,
      totalCreditsUsd: 10,
      source: 'new-api-token',
    });
  });

  it('does not expose New API unlimited-quota sentinel values as a negative balance', () => {
    expect(
      buildNewApiUsageSummary(
        'profile:lovbrowser',
        {
          code: true,
          data: {
            unlimited_quota: true,
            total_used: 191_101_642,
            total_available: -191_277_616,
            total_granted: -175_974,
          },
        },
        500_000,
        '2026-08-14T00:00:00.000Z'
      )
    ).toMatchObject({
      totalCostUsd: 382.203284,
      remainingCreditsUsd: null,
      totalCreditsUsd: null,
      source: 'new-api-token',
    });
  });

  it('uses the inference key as a bearer token after detecting New API', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { quota_per_unit: 500_000, quota_display_type: 'USD' },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { usage: 500_000, remain: 1_000_000 } }));

    const result = await fetchNewApiUsageSummary({
      endpoint: 'https://newapi.1234bot.com/v1',
      apiKey: 'lovbrowser-secret',
      platformId: 'profile:lovbrowser',
      fetchedAt: '2026-08-14T00:00:00.000Z',
      fetchImpl,
    });

    expect(result).toMatchObject({ totalCostUsd: 1, remainingCreditsUsd: 2 });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL('https://newapi.1234bot.com/api/usage/token/'),
      { headers: { Authorization: 'Bearer lovbrowser-secret' } }
    );
  });

  it('uses a separate account access token to map balance and total quota', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { quota_per_unit: 500_000, quota_display_type: 'USD' },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { total_used: 1_500_000, unlimited_quota: true } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { quota: 3_500_000, used_quota: 1_500_000 } })
      );

    const result = await fetchNewApiUsageSummary({
      endpoint: 'https://newapi.1234bot.com/v1',
      apiKey: 'inference-secret',
      accountAccessToken: 'account-secret',
      platformId: 'profile:lovbrowser',
      fetchedAt: '2026-08-14T00:00:00.000Z',
      fetchImpl,
    });

    expect(result).toMatchObject({
      totalCostUsd: 3,
      remainingCreditsUsd: 7,
      totalCreditsUsd: 10,
      quotaUnlimited: false,
      accountUsageStatus: 'available',
      source: 'new-api-account',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      new URL('https://newapi.1234bot.com/api/user/self'),
      { headers: { Authorization: 'Bearer account-secret' } }
    );
  });

  it('keeps token usage visible when the account credential is rejected', async () => {
    const tokenSummary = buildNewApiUsageSummary(
      'profile:lovbrowser',
      { data: { usage: 1_500_000, remain: 3_500_000 } },
      500_000,
      '2026-08-14T00:00:00.000Z'
    );
    expect(
      buildNewApiAccountUsageSummary(
        tokenSummary,
        { success: true, data: { quota: 3_500_000, used_quota: 1_500_000 } },
        500_000,
        '2026-08-14T00:00:00.000Z'
      )
    ).toMatchObject({ source: 'new-api-account', accountUsageStatus: 'available' });

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { quota_per_unit: 500_000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { usage: 1_500_000, remain: 3_500_000 } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid access token' }, 401));

    await expect(
      fetchNewApiUsageSummary({
        endpoint: 'https://newapi.1234bot.com/v1',
        apiKey: 'inference-secret',
        accountAccessToken: 'expired-account-secret',
        platformId: 'profile:lovbrowser',
        fetchImpl,
      })
    ).resolves.toMatchObject({
      totalCostUsd: 3,
      remainingCreditsUsd: 7,
      accountUsageStatus: 'error',
      accountUsageError: 'New API account usage returned 401: Invalid access token',
      source: 'new-api-token',
    });
  });

  it('reports a rate-limited token read as such, carrying the provider retry window', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { quota_per_unit: 500_000 } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '69' } }));

    await expect(
      fetchNewApiUsageSummary({
        endpoint: 'https://newapi.1234bot.com/v1',
        apiKey: 'inference-secret',
        platformId: 'profile:lovbrowser',
        fetchImpl,
      })
    ).rejects.toMatchObject({
      name: 'MaasUsageRateLimitError',
      retryAfterMs: 69_000,
    });
  });

  it('keeps token usage visible when only the account read is rate limited', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { quota_per_unit: 500_000 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { usage: 1_500_000, remain: 3_500_000 } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }));

    await expect(
      fetchNewApiUsageSummary({
        endpoint: 'https://newapi.1234bot.com/v1',
        apiKey: 'inference-secret',
        accountAccessToken: 'account-secret',
        platformId: 'profile:lovbrowser',
        fetchImpl,
      })
    ).resolves.toMatchObject({
      totalCostUsd: 3,
      remainingCreditsUsd: 7,
      accountUsageStatus: 'error',
      accountUsageError: 'New API usage API is rate limited (HTTP 429). Retry in 30s.',
      source: 'new-api-token',
    });
  });

  it('returns an unsupported result when the custom endpoint is not New API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [],
      })
    );

    await expect(
      fetchNewApiUsageSummary({
        endpoint: 'https://custom.example/v1',
        apiKey: 'custom-secret',
        platformId: 'profile:custom',
        fetchImpl,
      })
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps a real token API authorization failure visible after detection', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { quota_per_unit: 500_000 } }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Invalid token' }, 401));

    await expect(
      fetchNewApiUsageSummary({
        endpoint: 'https://newapi.example/v1',
        apiKey: 'expired-secret',
        platformId: 'profile:newapi',
        fetchImpl,
      })
    ).rejects.toThrow('New API token usage returned 401: Invalid token');
  });
});
