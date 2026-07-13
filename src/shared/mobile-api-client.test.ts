import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSnapshot } from '../../apps/mobile/src/api-client';
import { MOBILE_RELAY_BASE_URL } from './mobile-relay';

const relayConnection = {
  baseUrl: `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`,
  token: 'mobile-token',
};

describe('mobile API connectivity diagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identifies a phone network that cannot reach the Relay edge', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSnapshot(relayConnection)).rejects.toThrow(
      "Cannot reach Yoda Relay from this phone's current network"
    );

    expect(fetchMock).toHaveBeenCalledWith(`${MOBILE_RELAY_BASE_URL}/health`, {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('distinguishes a reachable Relay edge from an unreachable device route', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSnapshot(relayConnection)).rejects.toThrow(
      'Yoda Relay is reachable, but this desktop device route did not return an HTTP response'
    );
  });

  it('keeps local gateway guidance separate from Relay diagnostics', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchSnapshot({ baseUrl: 'http://192.168.1.20:3879', token: 'dev-token' })
    ).rejects.toThrow('Check Local Network permission, Wi-Fi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
