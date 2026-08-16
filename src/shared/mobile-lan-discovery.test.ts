import { describe, expect, it } from 'vitest';
import { subnetPrefix, sweepRanges } from '../../apps/mobile/src/lan-discovery';

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
});
