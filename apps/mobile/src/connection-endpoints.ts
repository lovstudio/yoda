import { MOBILE_RELAY_BASE_URL } from '@lovstudio/yoda-protocol/mobile-relay';
import type { MobileConnection } from './api-client';

/** Where a stored connection points. `lan` is a desktop reachable over the local
 *  network, `relay` is the official Yoda Relay device route, and `manual` is an
 *  address the user typed in themselves. */
export const MOBILE_ENDPOINT_KINDS = ['lan', 'relay', 'manual'] as const;
export type MobileEndpointKind = (typeof MOBILE_ENDPOINT_KINDS)[number];

/** Which transports the phone is allowed to use, in the user's own words.
 *  `auto` tries the LAN first and falls back to Relay, so a desktop that moved
 *  to another Wi-Fi stays reachable without re-pairing. */
export const MOBILE_TRANSPORT_PREFERENCES = ['auto', 'lan', 'relay', 'manual'] as const;
export type MobileTransportPreference = (typeof MOBILE_TRANSPORT_PREFERENCES)[number];

export function isMobileTransportPreference(value: unknown): value is MobileTransportPreference {
  return MOBILE_TRANSPORT_PREFERENCES.includes(value as MobileTransportPreference);
}

export type MobileEndpoint = MobileConnection & { kind: MobileEndpointKind };

export type MobileEndpointMap = Partial<Record<MobileEndpointKind, MobileConnection>>;

export type MobileConnectionSettings = {
  preference: MobileTransportPreference;
  endpoints: MobileEndpointMap;
};

export const DEFAULT_MOBILE_CONNECTION_SETTINGS: MobileConnectionSettings = {
  preference: 'auto',
  endpoints: {},
};

const PREFERENCE_ORDER: Record<MobileTransportPreference, readonly MobileEndpointKind[]> = {
  auto: ['lan', 'relay', 'manual'],
  lan: ['lan'],
  relay: ['relay'],
  manual: ['manual'],
};

export function normalizeEndpointBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** A pairing exchange returns a bare `{baseUrl, token}`; the slot it belongs to
 *  is derived from the URL rather than tracked separately, so a re-pair always
 *  replaces the matching slot instead of accumulating stale duplicates. */
export function classifyEndpointKind(baseUrl: string): Exclude<MobileEndpointKind, 'manual'> {
  try {
    const url = new URL(normalizeEndpointBaseUrl(baseUrl));
    const relay = new URL(MOBILE_RELAY_BASE_URL);
    return url.origin === relay.origin && /^\/v1\/devices\/[^/]+\/?$/.test(url.pathname)
      ? 'relay'
      : 'lan';
  } catch {
    return 'lan';
  }
}

export function putEndpoint(
  settings: MobileConnectionSettings,
  kind: MobileEndpointKind,
  connection: MobileConnection
): MobileConnectionSettings {
  return {
    ...settings,
    endpoints: {
      ...settings.endpoints,
      [kind]: {
        baseUrl: normalizeEndpointBaseUrl(connection.baseUrl),
        token: connection.token,
      },
    },
  };
}

export function removeEndpoint(
  settings: MobileConnectionSettings,
  kind: MobileEndpointKind
): MobileConnectionSettings {
  const endpoints = { ...settings.endpoints };
  delete endpoints[kind];
  return { ...settings, endpoints };
}

/** The candidates to try, best first. Duplicates are dropped so a manual entry
 *  that happens to repeat the paired LAN address is not probed twice. */
export function orderedEndpoints(settings: MobileConnectionSettings): MobileEndpoint[] {
  const seen = new Set<string>();
  const result: MobileEndpoint[] = [];
  for (const kind of PREFERENCE_ORDER[settings.preference] ?? PREFERENCE_ORDER.auto) {
    const connection = settings.endpoints[kind];
    if (!connection) continue;
    const baseUrl = normalizeEndpointBaseUrl(connection.baseUrl);
    const key = `${baseUrl}\0${connection.token}`;
    if (!baseUrl || !connection.token || seen.has(key)) continue;
    seen.add(key);
    result.push({ kind, baseUrl, token: connection.token });
  }
  return result;
}

export function primaryEndpoint(settings: MobileConnectionSettings): MobileEndpoint | null {
  return orderedEndpoints(settings)[0] ?? null;
}

export function endpointMatches(a: MobileConnection, b: MobileConnection): boolean {
  return (
    normalizeEndpointBaseUrl(a.baseUrl) === normalizeEndpointBaseUrl(b.baseUrl) &&
    a.token === b.token
  );
}

/** After a successful failover the winning endpoint is tried first, so the phone
 *  stops paying the dead endpoint's timeout on every later request. The stored
 *  preference is untouched — this only reorders the current attempt chain. */
export function withActiveEndpointFirst(
  candidates: readonly MobileEndpoint[],
  active: MobileConnection | null
): MobileEndpoint[] {
  if (!active) return [...candidates];
  const index = candidates.findIndex((candidate) => endpointMatches(candidate, active));
  if (index <= 0) return [...candidates];
  return [candidates[index], ...candidates.filter((_, i) => i !== index)];
}

function parseConnection(value: unknown): MobileConnection | null {
  if (typeof value !== 'object' || value === null) return null;
  const { baseUrl, token } = value as Partial<MobileConnection>;
  if (typeof baseUrl !== 'string' || typeof token !== 'string') return null;
  const normalized = normalizeEndpointBaseUrl(baseUrl);
  if (!normalized || !token) return null;
  return { baseUrl: normalized, token };
}

/** Reads either storage generation. Lives here rather than next to the storage
 *  calls so it stays free of native modules and can be tested directly. */
export function parseConnectionSettings(raw: string): MobileConnectionSettings | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  // v1 stored a single `{baseUrl, token}`; classify it into its slot so an
  // already-paired phone keeps working across the upgrade.
  const legacy = parseConnection(record);
  if (legacy) {
    return {
      preference: 'auto',
      endpoints: { [classifyEndpointKind(legacy.baseUrl)]: legacy },
    };
  }

  const preference = isMobileTransportPreference(record.preference) ? record.preference : 'auto';
  const rawEndpoints =
    typeof record.endpoints === 'object' && record.endpoints !== null
      ? (record.endpoints as Record<string, unknown>)
      : {};
  const endpoints: MobileEndpointMap = {};
  for (const kind of MOBILE_ENDPOINT_KINDS) {
    const connection = parseConnection(rawEndpoints[kind]);
    if (connection) endpoints[kind] = connection;
  }
  return { preference, endpoints };
}
