import type { IncomingMessage } from 'node:http';
import { matchMobileRelayRoute } from '@lovstudio/yoda-protocol/mobile-relay';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_PATH_LENGTH = 4_096;
const MAX_SEGMENT_LENGTH = 512;

export type ForwardableMobileRoute = {
  deviceId: string;
  upstreamPath: string;
  isEventStream: boolean;
};

export class RoutePolicyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function isValidDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

function decodeSegment(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new RoutePolicyError(400, 'invalid_path', 'Request path is invalid.');
  }
  if (
    !decoded ||
    decoded.length > MAX_SEGMENT_LENGTH ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  ) {
    throw new RoutePolicyError(400, 'invalid_path', 'Request path is invalid.');
  }
  return decoded;
}

function normalizedPath(segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

export function resolveForwardableMobileRoute(req: IncomingMessage): ForwardableMobileRoute {
  const method = req.method?.toUpperCase() ?? '';
  if (method !== 'GET' && method !== 'POST') {
    throw new RoutePolicyError(405, 'method_not_allowed', 'Request method is not allowed.');
  }

  const rawUrl = req.url ?? '/';
  if (rawUrl.length > MAX_PATH_LENGTH) {
    throw new RoutePolicyError(414, 'path_too_long', 'Request path is too long.');
  }
  const url = new URL(rawUrl, 'http://relay.invalid');
  if (url.search) {
    throw new RoutePolicyError(400, 'query_not_allowed', 'Query parameters are not allowed.');
  }

  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (rawSegments.length < 5 || rawSegments[0] !== 'v1' || rawSegments[1] !== 'devices') {
    throw new RoutePolicyError(404, 'not_found', 'Relay endpoint was not found.');
  }

  const deviceId = decodeSegment(rawSegments[2]!);
  if (!isValidDeviceId(deviceId)) {
    throw new RoutePolicyError(400, 'invalid_device_id', 'Device ID is invalid.');
  }
  // Decode each segment so traversal and injection attempts are rejected, then
  // re-encode into the canonical upstream path the allowlist is written against.
  const upstreamPath = normalizedPath(rawSegments.slice(3).map(decodeSegment));
  const route = matchMobileRelayRoute(method, upstreamPath);
  if (!route) {
    throw new RoutePolicyError(404, 'not_found', 'Relay endpoint was not found.');
  }

  return {
    deviceId,
    upstreamPath,
    isEventStream: route.isEventStream,
  };
}

export function resolveHostDeviceId(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://relay.invalid');
  if (url.search) throw new RoutePolicyError(400, 'invalid_host_path', 'Host path is invalid.');
  const rawSegments = url.pathname.split('/').filter(Boolean);
  if (rawSegments.length !== 3 || rawSegments[0] !== 'v1' || rawSegments[1] !== 'host') {
    throw new RoutePolicyError(404, 'not_found', 'Host endpoint was not found.');
  }
  const deviceId = decodeSegment(rawSegments[2]!);
  if (!isValidDeviceId(deviceId)) {
    throw new RoutePolicyError(400, 'invalid_device_id', 'Device ID is invalid.');
  }
  return deviceId;
}
