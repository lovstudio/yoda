import { MOBILE_GATEWAY_DEFAULT_PORT } from '../../../src/shared/mobile-api';
import { probeConnection, type MobileConnection } from './api-client';

const SWEEP_BATCH_SIZE = 24;
const SWEEP_TIMEOUT_MS = 900;
const HEALTH_PATH = '/health';

/** iOS Personal Hotspot always hands out `172.20.10.0/28`, and the phone itself
 *  is the gateway at `.1`. It is swept unconditionally because the phone cannot
 *  see that interface: the address lookup only reports `en*` interfaces, while
 *  the hotspot bridge is `bridge100`, so a desktop tethered to this very phone
 *  would otherwise be invisible to the scan. */
const HOTSPOT_SUBNET: SweepRange = { prefix: '172.20.10', lastHost: 14 };

type SweepRange = { prefix: string; lastHost: number };

export type LanDiscoveryResult = {
  /** The subnets that were swept, e.g. `['192.168.1', '172.20.10']`. Reported so
   *  a fruitless scan can say where it looked. */
  subnets: string[];
  /** Base URLs that answered `/health` and accepted the token. */
  matches: string[];
};

export function subnetPrefix(ipv4: string): string | null {
  const parts = ipv4.trim().split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  // `0.0.0.0` is what the platform reports when no `en*` interface holds an
  // address, and loopback means the phone is on no network at all. Sweeping
  // either would burn 254 doomed requests and then name a nonsense subnet.
  if (parts[0] === '0' || parts[0] === '127') return null;
  return parts.slice(0, 3).join('.');
}

/** The subnet a stored address lived on. A desktop that only changed host within
 *  its own network — the common case, since DHCP hands out a new lease on the
 *  same router — is found by sweeping this even when the phone sits on a
 *  different /24 of a wider subnet than the /24 its own address implies. */
export function subnetPrefixOfBaseUrl(baseUrl: string): string | null {
  try {
    return subnetPrefix(new URL(baseUrl.trim()).hostname);
  } catch {
    return null;
  }
}

/** The ranges worth sweeping, in the order they are tried: the phone's own
 *  subnet first, then the subnets its stored addresses used to live on, then the
 *  hotspot bridge the phone cannot see. */
export function sweepRanges(
  localIpv4: string | null,
  knownBaseUrls: readonly string[] = []
): SweepRange[] {
  const prefixes: string[] = [];
  const add = (prefix: string | null) => {
    if (prefix && !prefixes.includes(prefix)) prefixes.push(prefix);
  };
  add(localIpv4 ? subnetPrefix(localIpv4) : null);
  for (const baseUrl of knownBaseUrls) add(subnetPrefixOfBaseUrl(baseUrl));
  return [
    ...prefixes
      .filter((prefix) => prefix !== HOTSPOT_SUBNET.prefix)
      .map((prefix) => ({ prefix, lastHost: 254 })),
    HOTSPOT_SUBNET,
  ];
}

async function respondsToHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SWEEP_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${HEALTH_PATH}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Sweeps the subnets the phone can reach for a Yoda gateway.
 *
 *  `/health` is unauthenticated, so a hit only means *some* Yoda is listening;
 *  each hit is then re-checked with the stored token so a colleague's desktop
 *  on the same office Wi-Fi is never adopted. Runs in batches because a phone
 *  will not keep 254 sockets open at once. */
export async function discoverLanGateways(
  localIpv4: string | null,
  token: string,
  knownBaseUrls: readonly string[] = [],
  port: number = MOBILE_GATEWAY_DEFAULT_PORT
): Promise<LanDiscoveryResult> {
  const ranges = sweepRanges(localIpv4, knownBaseUrls);
  const hosts = ranges.flatMap((range) =>
    Array.from({ length: range.lastHost }, (_, index) => `${range.prefix}.${index + 1}`)
  );

  const found: string[] = [];
  for (let start = 0; start < hosts.length; start += SWEEP_BATCH_SIZE) {
    const batch = hosts.slice(start, start + SWEEP_BATCH_SIZE);
    const hits = await Promise.all(
      batch.map(async (host) => {
        const baseUrl = `http://${host}:${port}`;
        return (await respondsToHealth(baseUrl)) ? baseUrl : null;
      })
    );
    for (const baseUrl of hits) {
      if (baseUrl) found.push(baseUrl);
    }
  }

  const verified: string[] = [];
  for (const baseUrl of found) {
    const connection: MobileConnection = { baseUrl, token };
    if (await probeConnection(connection)) verified.push(baseUrl);
  }
  return { subnets: ranges.map((range) => range.prefix), matches: verified };
}
