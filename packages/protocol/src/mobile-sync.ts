/** How the desktop exposes itself to paired phones.
 *
 *  `lan` keeps everything on the local network: the gateway answers other hosts
 *  on the Wi-Fi, and Yoda Relay stays disconnected. `relay` is the inverse — the
 *  gateway only answers loopback (which the Relay bridge uses) so nothing on the
 *  local network can reach it, and traffic goes through Yoda Relay. `both` runs
 *  the two transports side by side so a phone can prefer the LAN and fall back
 *  to Relay when the desktop changes networks. */
export const MOBILE_SYNC_MODES = ['lan', 'relay', 'both'] as const;

export type MobileSyncMode = (typeof MOBILE_SYNC_MODES)[number];

export const DEFAULT_MOBILE_SYNC_MODE: MobileSyncMode = 'both';

export function isMobileSyncMode(value: unknown): value is MobileSyncMode {
  return MOBILE_SYNC_MODES.includes(value as MobileSyncMode);
}

export function lanSyncEnabled(mode: MobileSyncMode): boolean {
  return mode === 'lan' || mode === 'both';
}

export function relaySyncEnabled(mode: MobileSyncMode): boolean {
  return mode === 'relay' || mode === 'both';
}

/** Whether an incoming socket came from this machine.
 *
 *  Node reports IPv4 peers on a dual-stack listener as IPv4-mapped IPv6
 *  (`::ffff:127.0.0.1`), so a naive `=== '127.0.0.1'` would wrongly treat the
 *  Relay bridge as remote and lock the desktop out of its own gateway. */
export function isLoopbackRemoteAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '');
  if (normalized === '::1' || normalized === 'localhost') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}
