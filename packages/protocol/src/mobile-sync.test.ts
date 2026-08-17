import { describe, expect, it } from 'vitest';
import {
  isLoopbackRemoteAddress,
  isMobileSyncMode,
  lanSyncEnabled,
  relaySyncEnabled,
} from './mobile-sync.js';

describe('mobile sync mode', () => {
  it.each([
    ['lan', true, false],
    ['relay', false, true],
    ['both', true, true],
  ] as const)('%s enables the right transports', (mode, lan, relay) => {
    expect(lanSyncEnabled(mode)).toBe(lan);
    expect(relaySyncEnabled(mode)).toBe(relay);
  });

  it('rejects modes that are not part of the contract', () => {
    expect(isMobileSyncMode('lan')).toBe(true);
    expect(isMobileSyncMode('tailscale')).toBe(false);
    expect(isMobileSyncMode(null)).toBe(false);
  });
});

describe('isLoopbackRemoteAddress', () => {
  it('accepts the shapes Node reports on a dual-stack listener', () => {
    // The Relay bridge connects over IPv4 loopback, which a dual-stack socket
    // reports IPv4-mapped; treating that as remote would lock the desktop out
    // of its own gateway in relay-only mode.
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('127.1.2.3')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
  });

  it('treats every other host as remote', () => {
    expect(isLoopbackRemoteAddress('192.168.1.8')).toBe(false);
    expect(isLoopbackRemoteAddress('::ffff:192.168.1.8')).toBe(false);
    expect(isLoopbackRemoteAddress('1270.0.0.1')).toBe(false);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
    expect(isLoopbackRemoteAddress('')).toBe(false);
  });
});
