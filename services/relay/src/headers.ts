import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http';

const REQUEST_HEADER_ALLOWLIST = new Set(['accept', 'content-type', 'last-event-id']);
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'cache-control',
  'content-language',
  'content-type',
  'etag',
  'retry-after',
  'x-accel-buffering',
]);

export function bearerToken(headers: IncomingHttpHeaders): string | null {
  const authorization = headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer[ \t]+([^\s,]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return null;
}

export function sanitizedRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = headerString(headers[name]);
    if (value !== null) result[name] = value;
  }
  return result;
}

export function sanitizedResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!RESPONSE_HEADER_ALLOWLIST.has(name)) continue;
    if (/[\r\n]/.test(value)) continue;
    result[name] = value;
  }
  return result;
}

export function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

export function corsHeaders(
  req: IncomingMessage,
  allowedOrigins: readonly string[]
): OutgoingHttpHeaders {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Last-Event-ID',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

export function isCorsOriginAllowed(
  req: IncomingMessage,
  allowedOrigins: readonly string[]
): boolean {
  const origin = req.headers.origin;
  return typeof origin !== 'string' || allowedOrigins.includes(origin);
}
