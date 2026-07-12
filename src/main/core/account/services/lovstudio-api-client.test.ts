import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LovStudioApiClient } from './lovstudio-api-client';

const mocks = vi.hoisted(() => ({
  getRequestSession: vi.fn(),
  refreshRequestSession: vi.fn(),
  isRequestSessionCurrent: vi.fn(() => true),
}));

vi.mock('./yoda-account-service', () => ({
  yodaAccountService: mocks,
}));

vi.mock('../config', () => ({
  ACCOUNT_CONFIG: { authServer: { baseUrl: 'https://lovstudio.test' } },
}));

describe('LovStudioApiClient account binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRequestSessionCurrent.mockReturnValue(true);
    mocks.getRequestSession.mockResolvedValue({
      userId: 'account-a',
      accessToken: 'token-a',
      generation: 1,
      signal: new AbortController().signal,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not replay a 401 request after the originating account changes', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 401 })
    );
    vi.stubGlobal('fetch', fetchMock);
    mocks.refreshRequestSession.mockRejectedValue(new Error('LovStudio account session changed'));
    const client = new LovStudioApiClient();

    await expect(
      client.request('/api/yoda/relay/activate', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'request-a' },
      })
    ).rejects.toThrow('LovStudio account session changed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
    });
  });

  it('checks an expected account binding before starting the network request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    mocks.getRequestSession.mockRejectedValue(new Error('LovStudio account session changed'));
    const client = new LovStudioApiClient();

    await expect(
      client.request(
        '/api/yoda/relay/activate',
        { method: 'POST' },
        { expectedUserId: 'account-a', expectedGeneration: 7 }
      )
    ).rejects.toThrow('LovStudio account session changed');

    expect(mocks.getRequestSession).toHaveBeenCalledWith({
      expectedUserId: 'account-a',
      expectedGeneration: 7,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
