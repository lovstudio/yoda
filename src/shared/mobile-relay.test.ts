import { describe, expect, it } from 'vitest';
import {
  createMobileRelayPairingUrl,
  isAllowedMobileRelayRequest,
  parseMobileRelayHostFrame,
  parseMobileRelayPairingUrl,
  relayWebSocketUrl,
} from './mobile-relay';

describe('mobile relay contract', () => {
  it('round trips one-time pairing links', () => {
    const pairing = {
      deviceId: 'device-1',
      pairingCode: 'yrp_secret',
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    expect(parseMobileRelayPairingUrl(createMobileRelayPairingUrl(pairing))).toEqual(pairing);
  });

  it('only allows the narrow mobile API surface', () => {
    expect(isAllowedMobileRelayRequest('GET', '/v1/snapshot')).toBe(true);
    expect(isAllowedMobileRelayRequest('POST', '/v1/demands')).toBe(true);
    expect(
      isAllowedMobileRelayRequest(
        'GET',
        '/v1/projects/project/tasks/task/sessions/conversation/events'
      )
    ).toBe(true);
    expect(isAllowedMobileRelayRequest('POST', '/v1/projects/x/tasks/y/sessions/z/input')).toBe(
      true
    );
    expect(isAllowedMobileRelayRequest('GET', '/health')).toBe(false);
    expect(isAllowedMobileRelayRequest('POST', '/rpc')).toBe(false);
    expect(isAllowedMobileRelayRequest('DELETE', '/v1/demands')).toBe(false);
    expect(isAllowedMobileRelayRequest('GET', '/v1/snapshot?debug=1')).toBe(false);
  });

  it('rejects insecure or credential-bearing Relay origins', () => {
    expect(
      parseMobileRelayPairingUrl(
        'yodamobile://relay-pair?deviceId=d1&pairingCode=p1&relayBaseUrl=http%3A%2F%2Fevil.example'
      )
    ).toBeNull();
    expect(
      parseMobileRelayPairingUrl(
        'yodamobile://relay-pair?deviceId=d1&pairingCode=p1&relayBaseUrl=https%3A%2F%2Fuser%3Apass%40relay.example'
      )
    ).toBeNull();
  });

  it('converts an HTTPS Relay base URL to its host WebSocket endpoint', () => {
    expect(relayWebSocketUrl('https://relay.example.com/', 'device/1')).toBe(
      'wss://relay.example.com/v1/host/device%2F1'
    );
    expect(relayWebSocketUrl('https://relay.example.com/yoda', 'device-1')).toBe(
      'wss://relay.example.com/yoda/v1/host/device-1'
    );
  });

  it('rejects malformed host request frames at runtime', () => {
    expect(
      parseMobileRelayHostFrame({
        v: 1,
        type: 'request.start',
        requestId: 'request-1',
        path: '/v1/snapshot',
        headers: {},
      })
    ).toBeNull();
    expect(
      parseMobileRelayHostFrame({
        v: 1,
        type: 'request.start',
        requestId: 'request-1',
        method: 'GET',
        path: '/v1/snapshot',
        headers: { cookie: 'one\r\ntwo' },
      })
    ).toBeNull();
    expect(
      parseMobileRelayHostFrame({
        v: 1,
        type: 'request.start',
        requestId: 'request-1',
        method: 'GET',
        path: '/v1/snapshot',
        headers: { accept: 'application/json' },
      })
    ).toMatchObject({ type: 'request.start', method: 'GET' });
  });
});
