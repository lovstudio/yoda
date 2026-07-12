import { describe, expect, it, vi } from 'vitest';
import { LovStudioClient, type ControlPlaneError } from './lovstudio-client.js';

describe('LovStudioClient', () => {
  it('authorizes credentials through the internal service contract', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          authorized: true,
          accountId: 'account-1',
          deviceId: 'desktop-1',
          credentialId: 'credential-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const client = new LovStudioClient({
      baseUrl: 'https://lovstudio.example',
      serviceToken: 'service-secret',
      authorizePath: '/internal/authorize',
      pairPath: '/internal/pair',
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(
      client.authorize({ kind: 'host', token: 'host-secret', deviceId: 'desktop-1' })
    ).resolves.toEqual({
      accountId: 'account-1',
      deviceId: 'desktop-1',
      credentialId: 'credential-1',
      entitlementExpiresAt: undefined,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://lovstudio.example/internal/authorize');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer service-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: 'host',
      token: 'host-secret',
      deviceId: 'desktop-1',
    });
  });

  it('maps payment failures without exposing the internal response body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('internal details', { status: 402 }));
    const client = new LovStudioClient({
      baseUrl: 'https://lovstudio.example',
      serviceToken: 'service-secret',
      authorizePath: '/internal/authorize',
      pairPath: '/internal/pair',
      timeoutMs: 1_000,
      fetchImpl,
    });

    await expect(
      client.authorize({ kind: 'mobile', token: 'expired', deviceId: 'desktop-1' })
    ).rejects.toMatchObject({
      status: 402,
      code: 'payment_required',
    } satisfies Partial<ControlPlaneError>);
  });
});
