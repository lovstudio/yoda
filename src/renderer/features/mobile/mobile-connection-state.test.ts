import { describe, expect, it } from 'vitest';
import type { MobileGatewayConnectionInfo } from '@shared/mobile-api';
import type { MobileRelayStatus } from '@shared/mobile-relay';
import { deriveRelayConnectionUiState, hasReachableLocalGateway } from './mobile-connection-state';

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

function relay(overrides: Partial<MobileRelayStatus> = {}): MobileRelayStatus {
  return {
    configured: true,
    connected: true,
    connecting: false,
    deviceId: 'device-1',
    deviceName: 'Yoda Desktop',
    relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    pairingUrl: null,
    pairingExpiresAt: null,
    lastError: null,
    ...overrides,
  };
}

function derive(overrides: Partial<Parameters<typeof deriveRelayConnectionUiState>[0]> = {}) {
  return deriveRelayConnectionUiState({
    gatewayLoading: false,
    gatewayReady: true,
    accountLoading: false,
    accountUnavailable: false,
    isSignedIn: true,
    relayLoading: false,
    relayUnavailable: false,
    relay: relay(),
    now: NOW,
    ...overrides,
  });
}

describe('deriveRelayConnectionUiState', () => {
  it.each([
    [{ gatewayLoading: true }, 'loading'],
    [{ accountLoading: true }, 'loading'],
    [{ relayLoading: true }, 'loading'],
    [{ gatewayReady: false }, 'gateway-unavailable'],
    [{ accountUnavailable: true, relay: undefined }, 'account-unavailable'],
    [{ relayUnavailable: true, relay: undefined }, 'load-error'],
    [{ isSignedIn: false }, 'needs-sign-in'],
    [{ relay: relay({ configured: false }) }, 'needs-enable'],
    [{ relay: relay({ connected: false, connecting: true }) }, 'connecting'],
    [{ relay: relay({ connected: false }) }, 'offline'],
    [{ relay: relay() }, 'ready'],
  ] as const)('derives %s as %s', (overrides, phase) => {
    expect(derive(overrides)).toEqual({ phase, pairingUrl: null });
  });

  it('keeps an active Relay pairing URL as the only primary QR payload', () => {
    const pairingUrl = 'yodamobile://relay-pair?deviceId=device-1&pairingCode=one-time';
    expect(
      derive({
        relay: relay({
          pairingUrl,
          pairingExpiresAt: '2026-07-13T12:10:00.000Z',
        }),
      })
    ).toEqual({ phase: 'pairing-ready', pairingUrl });
  });

  it('keeps the sign-in action available when Relay status cannot load', () => {
    expect(
      derive({
        isSignedIn: false,
        relayUnavailable: true,
        relay: undefined,
      })
    ).toEqual({ phase: 'needs-sign-in', pairingUrl: null });
  });

  it('never exposes an expired Relay pairing URL or falls back to a local token QR', () => {
    expect(
      derive({
        relay: relay({
          pairingUrl: 'yodamobile://relay-pair?pairingCode=expired',
          pairingExpiresAt: '2026-07-13T11:59:59.000Z',
        }),
      })
    ).toEqual({ phase: 'pairing-expired', pairingUrl: null });
  });
});

describe('hasReachableLocalGateway', () => {
  const connection: MobileGatewayConnectionInfo = {
    enabled: true,
    running: true,
    mode: 'production',
    host: '0.0.0.0',
    port: 3879,
    token: 'local-token',
    urls: ['http://192.168.1.8:3879'],
    connectionKind: 'lan',
    localExpoUrl: null,
    installUrl: 'https://lovstudio.ai/yoda/mobile',
    pairingUrl: 'yodamobile://connect?baseUrl=http%3A%2F%2F192.168.1.8%3A3879&token=local-token',
  };

  it('allows reachable LAN and Tailscale gateway addresses', () => {
    expect(hasReachableLocalGateway(connection)).toBe(true);
    expect(
      hasReachableLocalGateway({
        ...connection,
        connectionKind: 'tailscale',
        urls: ['http://100.64.0.8:3879'],
      })
    ).toBe(true);
  });

  it('does not offer localhost or an empty address list to a phone', () => {
    expect(
      hasReachableLocalGateway({
        ...connection,
        connectionKind: 'local',
        urls: [],
        pairingUrl: 'yodamobile://connect?baseUrl=http%3A%2F%2Flocalhost%3A3879&token=local-token',
      })
    ).toBe(false);
    expect(hasReachableLocalGateway({ ...connection, urls: [] })).toBe(false);
  });
});
