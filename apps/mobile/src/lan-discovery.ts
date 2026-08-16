import { MOBILE_GATEWAY_DEFAULT_PORT } from '../../../src/shared/mobile-api';
import { probeConnection, type MobileConnection } from './api-client';

const SWEEP_BATCH_SIZE = 24;
const SWEEP_TIMEOUT_MS = 900;
const HEALTH_PATH = '/health';

export type LanDiscoveryResult = {
  /** The subnet that was swept, e.g. `192.168.1`. Null when the phone has no
   *  usable IPv4 address (cellular-only, or Local Network access denied). */
  subnet: string | null;
  /** Base URLs that answered `/health` and accepted the token. */
  matches: string[];
};

export function subnetPrefix(ipv4: string): string | null {
  const parts = ipv4.trim().split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return parts.slice(0, 3).join('.');
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

/** Sweeps the phone's own /24 for a Yoda gateway.
 *
 *  `/health` is unauthenticated, so a hit only means *some* Yoda is listening;
 *  each hit is then re-checked with the stored token so a colleague's desktop
 *  on the same office Wi-Fi is never adopted. Runs in batches because a phone
 *  will not keep 254 sockets open at once. */
export async function discoverLanGateways(
  localIpv4: string | null,
  token: string,
  port: number = MOBILE_GATEWAY_DEFAULT_PORT
): Promise<LanDiscoveryResult> {
  const subnet = localIpv4 ? subnetPrefix(localIpv4) : null;
  if (!subnet) return { subnet: null, matches: [] };

  const hosts = Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`);
  const matches: string[] = [];
  for (let start = 0; start < hosts.length; start += SWEEP_BATCH_SIZE) {
    const batch = hosts.slice(start, start + SWEEP_BATCH_SIZE);
    const hits = await Promise.all(
      batch.map(async (host) => {
        const baseUrl = `http://${host}:${port}`;
        return (await respondsToHealth(baseUrl)) ? baseUrl : null;
      })
    );
    for (const baseUrl of hits) {
      if (baseUrl) matches.push(baseUrl);
    }
  }

  const verified: string[] = [];
  for (const baseUrl of matches) {
    const connection: MobileConnection = { baseUrl, token };
    if (await probeConnection(connection)) verified.push(baseUrl);
  }
  return { subnet, matches: verified };
}
