import { describe, expect, it } from 'vitest';
import {
  subnetPrefix,
  subnetPrefixOfBaseUrl,
  sweepRanges,
} from '../../apps/mobile/src/lan-discovery';

describe('subnetPrefix', () => {
  it('rejects the addresses that mean "no network"', () => {
    // iOS only reports `en*` interfaces, so a phone sharing its connection over
    // the `bridge100` hotspot interface reports 0.0.0.0 — sweeping that would
    // burn 254 doomed requests and then name a nonsense subnet.
    expect(subnetPrefix('0.0.0.0')).toBeNull();
    expect(subnetPrefix('127.0.0.1')).toBeNull();
    expect(subnetPrefix('192.168.1')).toBeNull();
    expect(subnetPrefix('192.168.1.999')).toBeNull();
  });

  it('keeps the /24 prefix of a usable address', () => {
    expect(subnetPrefix('192.168.1.8')).toBe('192.168.1');
    expect(subnetPrefix(' 172.20.10.1 ')).toBe('172.20.10');
  });
});

describe('sweepRanges', () => {
  it('always covers the iOS hotspot subnet, which the phone cannot see itself', () => {
    expect(sweepRanges(null)).toEqual([{ prefix: '172.20.10', lastHost: 14 }]);
    expect(sweepRanges('0.0.0.0')).toEqual([{ prefix: '172.20.10', lastHost: 14 }]);
  });

  it("sweeps the phone's own subnet first", () => {
    expect(sweepRanges('192.168.1.8')).toEqual([
      { prefix: '192.168.1', lastHost: 254 },
      { prefix: '172.20.10', lastHost: 14 },
    ]);
  });

  it('does not sweep the hotspot subnet twice when the phone is already on it', () => {
    expect(sweepRanges('172.20.10.5')).toEqual([{ prefix: '172.20.10', lastHost: 14 }]);
  });

  it("sweeps the subnet a stored address used to be on, which need not be the phone's", () => {
    // The desktop sat on 192.168.100.x and moved host there. On a /23 network the
    // phone can hold 192.168.101.x, so its own prefix alone never finds it.
    expect(sweepRanges('192.168.101.7', ['http://192.168.100.124:3879'])).toEqual([
      { prefix: '192.168.101', lastHost: 254 },
      { prefix: '192.168.100', lastHost: 254 },
      { prefix: '172.20.10', lastHost: 14 },
    ]);
  });

  it('ignores stored addresses that add nothing to sweep', () => {
    expect(
      sweepRanges('192.168.1.8', [
        'http://192.168.1.20:3879',
        'https://relay.yoda.lovstudio.ai/v1/devices/abc',
        'not a url',
      ])
    ).toEqual([
      { prefix: '192.168.1', lastHost: 254 },
      { prefix: '172.20.10', lastHost: 14 },
    ]);
  });
});

describe('subnetPrefixOfBaseUrl', () => {
  it('reads the subnet out of a stored gateway address', () => {
    expect(subnetPrefixOfBaseUrl('http://192.168.100.124:3879')).toBe('192.168.100');
  });

  it('has no subnet for a hostname that is not an address', () => {
    expect(subnetPrefixOfBaseUrl('https://relay.yoda.lovstudio.ai/v1/devices/abc')).toBeNull();
    expect(subnetPrefixOfBaseUrl('')).toBeNull();
  });
});
