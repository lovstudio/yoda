export const MOBILE_RELAY_PROTOCOL_VERSION = 1 as const;
export const MOBILE_RELAY_PAIR_HOST = 'relay-pair';
export const MOBILE_RELAY_BASE_URL = 'https://relay.yoda.lovstudio.ai';
export const MOBILE_RELAY_HOST_CLOSE_CODE = {
  credentialRejected: 4001,
  passInactive: 4002,
  credentialForbidden: 4003,
  replaced: 4004,
} as const;

export type MobileRelayPairing = {
  deviceId: string;
  pairingCode: string;
  relayBaseUrl: string;
};

export type MobileRelayStatus = {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  deviceId: string | null;
  deviceName: string | null;
  relayBaseUrl: string | null;
  pairingUrl: string | null;
  pairingExpiresAt: string | null;
  lastError: string | null;
};

export function createMobileRelayPairingUrl(pairing: MobileRelayPairing): string {
  const params = new URLSearchParams(pairing);
  return `yodamobile://${MOBILE_RELAY_PAIR_HOST}?${params.toString()}`;
}

export function parseMobileRelayPairingUrl(rawUrl: string): MobileRelayPairing | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'yodamobile:' || url.hostname !== MOBILE_RELAY_PAIR_HOST) return null;
    const deviceId = url.searchParams.get('deviceId')?.trim() ?? '';
    const pairingCode = url.searchParams.get('pairingCode')?.trim() ?? '';
    const relayBaseUrl = url.searchParams.get('relayBaseUrl')?.trim().replace(/\/+$/, '') ?? '';
    const relayUrl = new URL(relayBaseUrl);
    if (
      !deviceId ||
      !pairingCode ||
      relayUrl.protocol !== 'https:' ||
      relayUrl.username ||
      relayUrl.password ||
      relayUrl.search ||
      relayUrl.hash
    )
      return null;
    return { deviceId, pairingCode, relayBaseUrl: relayUrl.toString().replace(/\/$/, '') };
  } catch {
    return null;
  }
}

export function canonicalizeMobileRelayPairing(pairing: MobileRelayPairing): MobileRelayPairing {
  return { ...pairing, relayBaseUrl: MOBILE_RELAY_BASE_URL };
}

export type MobileRelayRequestFrame = {
  v: 1;
  type: 'request.start';
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type MobileRelayCancelFrame = {
  v: 1;
  type: 'request.cancel';
  requestId: string;
  reason?: string;
};

export type MobileRelayResponseFrame =
  | {
      v: 1;
      type: 'response.start';
      requestId: string;
      status: number;
      headers: Record<string, string>;
    }
  | {
      v: 1;
      type: 'response.chunk';
      requestId: string;
      sequence: number;
      bodyBase64: string;
    }
  | { v: 1; type: 'response.end'; requestId: string }
  | { v: 1; type: 'response.error'; requestId: string; code: string; message: string };

export type MobileRelayHostFrame = MobileRelayRequestFrame | MobileRelayCancelFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRelayHeaders(value: unknown): Record<string, string> | null {
  if (!isRecord(value) || Object.keys(value).length > 32) return null;
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
      typeof headerValue !== 'string' ||
      headerValue.length > 8_192 ||
      /[\r\n\0]/.test(headerValue)
    ) {
      return null;
    }
    headers[name] = headerValue;
  }
  return headers;
}

export function parseMobileRelayHostFrame(value: unknown): MobileRelayHostFrame | null {
  if (
    !isRecord(value) ||
    value.v !== MOBILE_RELAY_PROTOCOL_VERSION ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9:_-]{1,128}$/.test(value.requestId)
  ) {
    return null;
  }
  if (value.type === 'request.cancel') {
    if (
      value.reason !== undefined &&
      (typeof value.reason !== 'string' || value.reason.length > 128)
    ) {
      return null;
    }
    return {
      v: 1,
      type: 'request.cancel',
      requestId: value.requestId,
      ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    };
  }
  if (
    value.type !== 'request.start' ||
    (value.method !== 'GET' && value.method !== 'POST') ||
    typeof value.path !== 'string' ||
    value.path.length > 4_096 ||
    !value.path.startsWith('/') ||
    /[\r\n\0]/.test(value.path)
  ) {
    return null;
  }
  const headers = parseRelayHeaders(value.headers);
  if (!headers) return null;
  if (
    value.bodyBase64 !== undefined &&
    (typeof value.bodyBase64 !== 'string' ||
      value.bodyBase64.length > 180_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64))
  ) {
    return null;
  }
  return {
    v: 1,
    type: 'request.start',
    requestId: value.requestId,
    method: value.method,
    path: value.path,
    headers,
    ...(typeof value.bodyBase64 === 'string' ? { bodyBase64: value.bodyBase64 } : {}),
  };
}

const MOBILE_RELAY_ALLOWED_PATHS = [
  /^\/v1\/snapshot$/,
  /^\/v1\/demands$/,
  /^\/v1\/projects\/[^/?]+\/tasks\/[^/?]+\/sessions$/,
  /^\/v1\/projects\/[^/?]+\/tasks\/[^/?]+\/sessions\/[^/?]+(?:\/input|\/events)?$/,
];

export function isAllowedMobileRelayRequest(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (!['GET', 'POST'].includes(normalizedMethod)) return false;
  return MOBILE_RELAY_ALLOWED_PATHS.some((pattern) => pattern.test(path));
}

export function relayWebSocketUrl(relayBaseUrl: string, deviceId: string): string {
  const base = new URL(relayBaseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const prefix = base.pathname.replace(/\/$/, '');
  base.pathname = `${prefix}/v1/host/${encodeURIComponent(deviceId)}`;
  base.search = '';
  return base.toString();
}
