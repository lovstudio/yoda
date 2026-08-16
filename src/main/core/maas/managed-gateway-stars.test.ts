import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaasManagedGatewayStarSnapshot } from '@shared/maas';
import { MaasManagedGatewayStarsService } from './managed-gateway-stars';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

function githubResponse(
  payload: unknown,
  status = 200
): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown> } {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: async () => payload,
  };
}

function historyResponse(
  rows = [
    { date: '2023-08-14', stargazers: '100' },
    { date: '2026-08-03', stargazers: '200' },
  ],
  status = 200
) {
  return githubResponse({ data: { rows } }, status);
}

describe('MaaS managed gateway GitHub stars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.startsWith('https://api.ossinsight.io/')
        ? historyResponse()
        : githubResponse({ stargazers_count: 1234 })
    );
  });

  it('loads the repositories in the product order and caches the result', async () => {
    const service = new MaasManagedGatewayStarsService();

    const first = await service.list();
    const second = await service.list();

    expect(first.map((item) => item.platformId)).toEqual([
      'litellm',
      'cliproxyapi',
      'newapi',
      'ccswitch',
    ]);
    expect(first.every((item) => item.starCount === 1234)).toBe(true);
    expect(first.every((item) => item.trend?.points.at(-1)?.starCount === 1234)).toBe(true);
    expect(first.every((item) => item.trend?.calibratedToCurrent === true)).toBe(true);
    expect(second).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(8);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/BerriAI/litellm',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'Yoda' }),
      })
    );
  });

  it('requests weekly history for the last three years', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    try {
      await new MaasManagedGatewayStarsService().list();
    } finally {
      vi.useRealTimers();
    }

    const historyUrls = mocks.fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('https://api.ossinsight.io/'));
    expect(historyUrls).toHaveLength(4);
    for (const url of historyUrls) {
      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.get('per')).toBe('week');
      expect(parsedUrl.searchParams.get('from')).toBe('2023-08-10');
      expect(parsedUrl.searchParams.get('to')).toBe('2026-08-10');
    }
  });

  it('keeps the other counts available when one repository cannot be read', async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.includes('/QuantumNous/new-api')
        ? url.startsWith('https://api.ossinsight.io/')
          ? historyResponse()
          : githubResponse({}, 200)
        : url.startsWith('https://api.ossinsight.io/')
          ? historyResponse()
          : githubResponse({ stargazers_count: 9876 })
    );

    const result = await new MaasManagedGatewayStarsService().list();
    const byId = new Map(result.map((item) => [item.platformId, item]));

    expect(byId.get('litellm')?.starCount).toBe(9876);
    expect(byId.get('cliproxyapi')?.starCount).toBe(9876);
    expect(byId.get('ccswitch')?.starCount).toBe(9876);
    expect(byId.get('newapi')?.starCount).toBeNull();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('supports refreshing the cached snapshot', async () => {
    const service = new MaasManagedGatewayStarsService();
    await service.list();
    mocks.fetch.mockImplementation(async (url: string) =>
      url.startsWith('https://api.ossinsight.io/')
        ? historyResponse()
        : githubResponse({ stargazers_count: 5678 })
    );

    const refreshed: MaasManagedGatewayStarSnapshot[] = await service.list(true);

    expect(refreshed.every((item) => item.starCount === 5678)).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(16);
  });
});
