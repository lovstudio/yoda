export const DEFAULT_MAX_REQUEST_BODY_BYTES = 128 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = 256 * 1024;
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;
export const DEFAULT_MAX_CONCURRENT_STREAMS = 8;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000;
export const DEFAULT_CONTROL_PLANE_TIMEOUT_MS = 5_000;
export const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_HOST_REAUTHORIZE_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_WS_BUFFERED_BYTES = 1024 * 1024;

export type RelayConfig = {
  host: string;
  port: number;
  publicBaseUrl: string;
  lovstudioBaseUrl: string;
  lovstudioServiceToken: string;
  lovstudioAuthorizePath: string;
  lovstudioPairPath: string;
  corsAllowedOrigins: string[];
  maxRequestBodyBytes: number;
  maxResponseBytes: number;
  maxFrameBytes: number;
  maxConcurrentRequestsPerDevice: number;
  maxConcurrentStreamsPerDevice: number;
  requestTimeoutMs: number;
  streamIdleTimeoutMs: number;
  controlPlaneTimeoutMs: number;
  wsHeartbeatIntervalMs: number;
  hostReauthorizeIntervalMs: number;
  maxWsBufferedBytes: number;
};

function integerEnv(name: string, fallback: number, options: { min?: number; max?: number } = {}) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizedHttpUrl(name: string, value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https.`);
  }
  if (url.username || url.password) throw new Error(`${name} must not include credentials.`);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error(`${name} must use https in production.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizedPath(name: string, value: string): string {
  const path = value.trim();
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new Error(`${name} must be an absolute URL path.`);
  }
  return path;
}

export function loadRelayConfig(): RelayConfig {
  return {
    host: process.env.YODA_RELAY_HOST?.trim() || '0.0.0.0',
    port: integerEnv('YODA_RELAY_PORT', 8787, { min: 0, max: 65_535 }),
    publicBaseUrl: normalizedHttpUrl(
      'YODA_RELAY_PUBLIC_BASE_URL',
      process.env.YODA_RELAY_PUBLIC_BASE_URL?.trim() || 'http://localhost:8787'
    ),
    lovstudioBaseUrl: normalizedHttpUrl(
      'LOVSTUDIO_BASE_URL',
      process.env.LOVSTUDIO_BASE_URL?.trim() || 'https://lovstudio.ai'
    ),
    lovstudioServiceToken: requiredEnv('LOVSTUDIO_RELAY_SERVICE_TOKEN'),
    lovstudioAuthorizePath: normalizedPath(
      'LOVSTUDIO_RELAY_AUTHORIZE_PATH',
      process.env.LOVSTUDIO_RELAY_AUTHORIZE_PATH?.trim() || '/api/yoda/relay/authorize'
    ),
    lovstudioPairPath: normalizedPath(
      'LOVSTUDIO_RELAY_PAIR_PATH',
      process.env.LOVSTUDIO_RELAY_PAIR_PATH?.trim() || '/api/yoda/relay/pair'
    ),
    corsAllowedOrigins: (process.env.YODA_RELAY_CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxRequestBodyBytes: integerEnv(
      'YODA_RELAY_MAX_REQUEST_BODY_BYTES',
      DEFAULT_MAX_REQUEST_BODY_BYTES
    ),
    maxResponseBytes: integerEnv('YODA_RELAY_MAX_RESPONSE_BYTES', DEFAULT_MAX_RESPONSE_BYTES),
    maxFrameBytes: integerEnv('YODA_RELAY_MAX_FRAME_BYTES', DEFAULT_MAX_FRAME_BYTES),
    maxConcurrentRequestsPerDevice: integerEnv(
      'YODA_RELAY_MAX_CONCURRENT_REQUESTS',
      DEFAULT_MAX_CONCURRENT_REQUESTS
    ),
    maxConcurrentStreamsPerDevice: integerEnv(
      'YODA_RELAY_MAX_CONCURRENT_STREAMS',
      DEFAULT_MAX_CONCURRENT_STREAMS
    ),
    requestTimeoutMs: integerEnv('YODA_RELAY_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS),
    streamIdleTimeoutMs: integerEnv(
      'YODA_RELAY_STREAM_IDLE_TIMEOUT_MS',
      DEFAULT_STREAM_IDLE_TIMEOUT_MS
    ),
    controlPlaneTimeoutMs: integerEnv(
      'YODA_RELAY_CONTROL_PLANE_TIMEOUT_MS',
      DEFAULT_CONTROL_PLANE_TIMEOUT_MS
    ),
    wsHeartbeatIntervalMs: integerEnv(
      'YODA_RELAY_WS_HEARTBEAT_INTERVAL_MS',
      DEFAULT_WS_HEARTBEAT_INTERVAL_MS
    ),
    hostReauthorizeIntervalMs: integerEnv(
      'YODA_RELAY_HOST_REAUTHORIZE_INTERVAL_MS',
      DEFAULT_HOST_REAUTHORIZE_INTERVAL_MS,
      { min: 10_000 }
    ),
    maxWsBufferedBytes: integerEnv(
      'YODA_RELAY_MAX_WS_BUFFERED_BYTES',
      DEFAULT_MAX_WS_BUFFERED_BYTES
    ),
  };
}
