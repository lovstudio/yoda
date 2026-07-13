import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isTailscaleIpv4, mobileGatewayNetworkUrls } from './network-addresses';

function address(value: string, internal = false): NetworkInterfaceInfo {
  return {
    address: value,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${value}/24`,
  };
}

describe('mobile gateway network addresses', () => {
  it('recognizes the Tailscale IPv4 range', () => {
    expect(isTailscaleIpv4('100.64.0.1')).toBe(true);
    expect(isTailscaleIpv4('100.127.255.254')).toBe(true);
    expect(isTailscaleIpv4('100.128.0.1')).toBe(false);
    expect(isTailscaleIpv4('192.168.1.2')).toBe(false);
  });

  it('prefers Tailscale while preserving LAN fallbacks', () => {
    expect(
      mobileGatewayNetworkUrls(
        {
          en0: [address('192.168.1.20')],
          utun4: [address('100.101.102.103')],
          lo0: [address('127.0.0.1', true)],
        },
        3879
      )
    ).toEqual([
      { kind: 'tailscale', url: 'http://100.101.102.103:3879' },
      { kind: 'lan', url: 'http://192.168.1.20:3879' },
    ]);
  });
});
