import { describe, expect, it } from 'vitest';
import { parseConnectionSettings } from '../../apps/mobile/src/connection-endpoints';
import { MOBILE_RELAY_BASE_URL } from './mobile-relay';

describe('parseConnectionSettings', () => {
  it('migrates a v1 single-endpoint record into its matching slot', () => {
    // An already-paired phone must keep working across the upgrade rather than
    // dropping back to the pairing screen.
    expect(
      parseConnectionSettings(
        JSON.stringify({ baseUrl: 'http://192.168.1.8:3879/', token: 'lan-token' })
      )
    ).toEqual({
      preference: 'auto',
      endpoints: { lan: { baseUrl: 'http://192.168.1.8:3879', token: 'lan-token' } },
    });

    expect(
      parseConnectionSettings(
        JSON.stringify({
          baseUrl: `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`,
          token: 'relay-token',
        })
      )
    ).toEqual({
      preference: 'auto',
      endpoints: {
        relay: { baseUrl: `${MOBILE_RELAY_BASE_URL}/v1/devices/device-1`, token: 'relay-token' },
      },
    });
  });

  it('reads a v2 record and drops slots that cannot be used', () => {
    expect(
      parseConnectionSettings(
        JSON.stringify({
          preference: 'relay',
          endpoints: {
            lan: { baseUrl: 'http://192.168.1.8:3879', token: 'lan-token' },
            relay: { baseUrl: '', token: 'relay-token' },
            manual: { baseUrl: 'http://10.0.0.5:3879', token: 42 },
            bogus: { baseUrl: 'http://10.0.0.9:3879', token: 'x' },
          },
        })
      )
    ).toEqual({
      preference: 'relay',
      endpoints: { lan: { baseUrl: 'http://192.168.1.8:3879', token: 'lan-token' } },
    });
  });

  it('falls back to auto for an unknown preference and rejects unusable payloads', () => {
    expect(parseConnectionSettings(JSON.stringify({ preference: 'tailscale' }))).toEqual({
      preference: 'auto',
      endpoints: {},
    });
    expect(parseConnectionSettings('not json')).toBeNull();
    expect(parseConnectionSettings('null')).toBeNull();
    expect(parseConnectionSettings('"a string"')).toBeNull();
  });
});
