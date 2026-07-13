import type { NetworkInterfaceInfo } from 'node:os';

export type MobileGatewayNetworkUrl = {
  kind: 'tailscale' | 'lan';
  url: string;
};

export function isTailscaleIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    octets[0] === 100 &&
    octets[1] >= 64 &&
    octets[1] <= 127
  );
}

function isUsableAddress(address: string): boolean {
  return !/^198\.(?:18|19)\./.test(address) && !address.startsWith('169.254.');
}

function interfaceRank(name: string): number {
  if (/^(en|eth|wlan|wl)/i.test(name)) return 0;
  if (/^(utun|tun|tap|wg|zt|ipsec|ppp)/i.test(name)) return 2;
  return 1;
}

export function mobileGatewayNetworkUrls(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  port: number
): MobileGatewayNetworkUrl[] {
  const candidates: Array<MobileGatewayNetworkUrl & { rank: number }> = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isUsableAddress(entry.address)) continue;
      const tailscale = isTailscaleIpv4(entry.address);
      candidates.push({
        kind: tailscale ? 'tailscale' : 'lan',
        url: `http://${entry.address}:${port}`,
        rank: tailscale ? -1 : interfaceRank(name),
      });
    }
  }
  return candidates
    .sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url))
    .map(({ kind, url }) => ({ kind, url }));
}
