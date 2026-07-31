import { describe, expect, it } from 'vitest';
import {
  explicitMobilePairingUrl,
  selectMobileConnectionBootstrapFallback,
} from '../../apps/mobile/src/connection-bootstrap';

const savedConnection = {
  baseUrl: 'https://relay.yoda.lovstudio.ai/v1/devices/saved-device',
  token: 'saved-mobile-token',
};

const developmentConnection = {
  baseUrl: 'http://192.168.1.8:3879',
  token: 'dev-mobile-token',
};

describe('mobile connection bootstrap', () => {
  it('only treats the actual launch URL as an explicit pairing request', () => {
    expect(
      explicitMobilePairingUrl(
        'yodamobile://connect?baseUrl=http%3A%2F%2F192.168.1.8%3A3879&token=mobile-token'
      )
    ).toContain('yodamobile://connect');
    expect(
      explicitMobilePairingUrl(
        'yodamobile://relay-pair?deviceId=device-1&pairingCode=one-time&relayBaseUrl=https%3A%2F%2Frelay.yoda.lovstudio.ai'
      )
    ).toContain('yodamobile://relay-pair');
    expect(explicitMobilePairingUrl('exp://192.168.1.8:8081')).toBeNull();
    expect(explicitMobilePairingUrl(null)).toBeNull();
  });

  it('restores a paired device before considering an inferred development connection', () => {
    expect(selectMobileConnectionBootstrapFallback(savedConnection, developmentConnection)).toEqual(
      {
        connection: savedConnection,
        shouldPersist: false,
      }
    );
  });

  it('persists the development fallback only when no paired device exists', () => {
    expect(selectMobileConnectionBootstrapFallback(null, developmentConnection)).toEqual({
      connection: developmentConnection,
      shouldPersist: true,
    });
    expect(selectMobileConnectionBootstrapFallback(null, null)).toBeNull();
  });
});
