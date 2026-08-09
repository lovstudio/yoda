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

describe('MaaS managed gateway GitHub stars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(githubResponse({ stargazers_count: 1234 }));
  });

  it('loads the repositories in the product order and caches the result', async () => {
    const service = new MaasManagedGatewayStarsService();

    const first = await service.list();
    const second = await service.list();

    expect(first.map((item) => item.platformId)).toEqual(['litellm', 'cliproxyapi', 'newapi']);
    expect(first.every((item) => item.starCount === 1234)).toBe(true);
    expect(second).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/BerriAI/litellm',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'Yoda' }),
      })
    );
  });

  it('keeps the other counts available when one repository cannot be read', async () => {
    mocks.fetch.mockImplementation(async (url: string) =>
      url.endsWith('/QuantumNous/new-api')
        ? githubResponse({}, 200)
        : githubResponse({ stargazers_count: 9876 })
    );

    const result = await new MaasManagedGatewayStarsService().list();
    const byId = new Map(result.map((item) => [item.platformId, item]));

    expect(byId.get('litellm')?.starCount).toBe(9876);
    expect(byId.get('cliproxyapi')?.starCount).toBe(9876);
    expect(byId.get('newapi')?.starCount).toBeNull();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it('supports refreshing the cached snapshot', async () => {
    const service = new MaasManagedGatewayStarsService();
    await service.list();
    mocks.fetch.mockResolvedValue(githubResponse({ stargazers_count: 5678 }));

    const refreshed: MaasManagedGatewayStarSnapshot[] = await service.list(true);

    expect(refreshed.every((item) => item.starCount === 5678)).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
  });
});
