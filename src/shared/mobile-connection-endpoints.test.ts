import { describe, expect, it } from 'vitest';
import {
  classifyEndpointKind,
  DEFAULT_MOBILE_CONNECTION_SETTINGS,
  orderedEndpoints,
  primaryEndpoint,
  putEndpoint,
  removeEndpoint,
  withActiveEndpointFirst,
  type MobileConnectionSettings,
} from '../../apps/mobile/src/connection-endpoints';
import { MOBILE_RELAY_BASE_URL } from './mobile-relay';

const RELAY_DEVICE_URL = `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`;

function settings(overrides: Partial<MobileConnectionSettings> = {}): MobileConnectionSettings {
  return {
    preference: 'auto',
    endpoints: {
      lan: { baseUrl: 'http://192.168.1.8:3879', token: 'lan-token' },
      relay: { baseUrl: RELAY_DEVICE_URL, token: 'relay-token' },
      manual: { baseUrl: 'http://10.0.0.5:3879', token: 'manual-token' },
    },
    ...overrides,
  };
}

describe('classifyEndpointKind', () => {
  it('recognises a Relay device route and treats everything else as LAN', () => {
    expect(classifyEndpointKind(RELAY_DEVICE_URL)).toBe('relay');
    expect(classifyEndpointKind(`${RELAY_DEVICE_URL}/`)).toBe('relay');
    expect(classifyEndpointKind('http://192.168.1.8:3879')).toBe('lan');
    // The Relay origin without a device route is not a usable device endpoint.
    expect(classifyEndpointKind(`${MOBILE_RELAY_BASE_URL}/v1/pair`)).toBe('lan');
    expect(classifyEndpointKind('not a url')).toBe('lan');
  });
});

describe('orderedEndpoints', () => {
  it('tries the LAN first under auto so the phone stays off the public path', () => {
    expect(orderedEndpoints(settings()).map((e) => e.kind)).toEqual(['lan', 'relay', 'manual']);
  });

  it.each(['lan', 'relay', 'manual'] as const)(
    'restricts %s to its own transport',
    (preference) => {
      expect(orderedEndpoints(settings({ preference })).map((e) => e.kind)).toEqual([preference]);
    }
  );

  it('drops empty and duplicate endpoints', () => {
    const duplicated = settings({
      endpoints: {
        lan: { baseUrl: 'http://192.168.1.8:3879/', token: 'lan-token' },
        manual: { baseUrl: 'http://192.168.1.8:3879', token: 'lan-token' },
        relay: { baseUrl: RELAY_DEVICE_URL, token: '' },
      },
    });
    expect(orderedEndpoints(duplicated).map((e) => e.baseUrl)).toEqual(['http://192.168.1.8:3879']);
  });

  it('has nothing to offer a phone that has never paired', () => {
    expect(orderedEndpoints(DEFAULT_MOBILE_CONNECTION_SETTINGS)).toEqual([]);
    expect(primaryEndpoint(DEFAULT_MOBILE_CONNECTION_SETTINGS)).toBeNull();
  });
});

describe('putEndpoint / removeEndpoint', () => {
  it('replaces a slot instead of accumulating stale duplicates', () => {
    const next = putEndpoint(settings(), 'lan', {
      baseUrl: 'http://192.168.5.20:3879/',
      token: 'fresh',
    });
    expect(next.endpoints.lan).toEqual({ baseUrl: 'http://192.168.5.20:3879', token: 'fresh' });
    expect(Object.keys(next.endpoints).sort()).toEqual(['lan', 'manual', 'relay']);
  });

  it('removes only the named slot', () => {
    const next = removeEndpoint(settings(), 'manual');
    expect(next.endpoints.manual).toBeUndefined();
    expect(next.endpoints.lan).toBeDefined();
    expect(next.endpoints.relay).toBeDefined();
  });
});

describe('withActiveEndpointFirst', () => {
  it('stops paying the dead endpoint timeout after a failover', () => {
    const candidates = orderedEndpoints(settings());
    const active = { baseUrl: RELAY_DEVICE_URL, token: 'relay-token' };
    expect(withActiveEndpointFirst(candidates, active).map((e) => e.kind)).toEqual([
      'relay',
      'lan',
      'manual',
    ]);
  });

  it('leaves the order alone when the active endpoint is already first or unknown', () => {
    const candidates = orderedEndpoints(settings());
    expect(withActiveEndpointFirst(candidates, candidates[0]).map((e) => e.kind)).toEqual([
      'lan',
      'relay',
      'manual',
    ]);
    expect(
      withActiveEndpointFirst(candidates, { baseUrl: 'http://8.8.8.8:3879', token: 'x' }).map(
        (e) => e.kind
      )
    ).toEqual(['lan', 'relay', 'manual']);
    expect(withActiveEndpointFirst(candidates, null).map((e) => e.kind)).toEqual([
      'lan',
      'relay',
      'manual',
    ]);
  });
});
