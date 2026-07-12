import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { RELAY_HOST_CLOSE_CODE } from './close-codes.js';
import type { RelayConfig } from './config.js';
import {
  bearerToken,
  corsHeaders,
  isCorsOriginAllowed,
  sanitizedRequestHeaders,
} from './headers.js';
import { HostRegistry } from './host-registry.js';
import { HttpError, readBody, readJsonObject, writeApiError, writeJson } from './http-utils.js';
import {
  ControlPlaneError,
  LovStudioClient,
  type LovStudioControlPlane,
} from './lovstudio-client.js';
import {
  isValidDeviceId,
  resolveForwardableMobileRoute,
  resolveHostDeviceId,
  RoutePolicyError,
} from './route-policy.js';

export type RelayServerOptions = {
  config: RelayConfig;
  controlPlane?: LovStudioControlPlane;
};

export type RelayServer = {
  server: http.Server;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
};

function asHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof RoutePolicyError) {
    return new HttpError(error.status, error.code, error.message);
  }
  if (error instanceof ControlPlaneError) {
    return new HttpError(error.status, error.code, error.message);
  }
  return new HttpError(500, 'internal_error', 'Relay request failed.');
}

function httpStatusText(status: number): string {
  return http.STATUS_CODES[status] ?? 'Error';
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${httpStatusText(status)}\r\n` +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      'X-Content-Type-Options: nosniff\r\n' +
      '\r\n'
  );
}

function hostAuthorizationCloseCode(error: unknown): number | null {
  if (!(error instanceof ControlPlaneError)) return null;
  if (error.status === 402) return RELAY_HOST_CLOSE_CODE.passInactive;
  if ([401, 403, 404].includes(error.status)) return RELAY_HOST_CLOSE_CODE.credentialRejected;
  return null;
}

function validatePairingBody(value: Record<string, unknown>): {
  deviceId: string;
  pairingCode: string;
} {
  const deviceId = typeof value.deviceId === 'string' ? value.deviceId.trim() : '';
  const pairingCode = typeof value.pairingCode === 'string' ? value.pairingCode.trim() : '';
  if (!isValidDeviceId(deviceId)) {
    throw new HttpError(400, 'invalid_device_id', 'Device ID is invalid.');
  }
  if (!pairingCode || pairingCode.length > 512 || /[\r\n\0]/.test(pairingCode)) {
    throw new HttpError(400, 'invalid_pairing_code', 'Pairing code is invalid.');
  }
  return { deviceId, pairingCode };
}

async function readForwardBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number
): Promise<Buffer> {
  if (req.method !== 'POST') return Buffer.alloc(0);
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const body = await readBody(req, maxBytes, timeoutMs);
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object');
    }
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object.');
  }
  return body;
}

export function createRelayServer({ config, controlPlane }: RelayServerOptions): RelayServer {
  const lovstudio =
    controlPlane ??
    new LovStudioClient({
      baseUrl: config.lovstudioBaseUrl,
      serviceToken: config.lovstudioServiceToken,
      authorizePath: config.lovstudioAuthorizePath,
      pairPath: config.lovstudioPairPath,
      timeoutMs: config.controlPlaneTimeoutMs,
    });
  const registry = new HostRegistry({
    corsAllowedOrigins: config.corsAllowedOrigins,
    maxConcurrentRequestsPerDevice: config.maxConcurrentRequestsPerDevice,
    maxConcurrentStreamsPerDevice: config.maxConcurrentStreamsPerDevice,
    maxFrameBytes: config.maxFrameBytes,
    maxResponseBytes: config.maxResponseBytes,
    maxWsBufferedBytes: config.maxWsBufferedBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    wsHeartbeatIntervalMs: config.wsHeartbeatIntervalMs,
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: config.maxFrameBytes });

  const handlePair = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = validatePairingBody(
      await readJsonObject(req, config.maxRequestBodyBytes, config.requestTimeoutMs)
    );
    const paired = await lovstudio.pair(body);
    if (paired.deviceId !== body.deviceId) {
      throw new HttpError(502, 'pairing_mismatch', 'LovStudio returned a mismatched Relay device.');
    }
    writeJson(
      req,
      res,
      200,
      {
        deviceId: paired.deviceId,
        baseUrl: `${config.publicBaseUrl}/v1/devices/${encodeURIComponent(paired.deviceId)}`,
        token: paired.mobileToken,
        ...(paired.expiresAt ? { expiresAt: paired.expiresAt } : {}),
      },
      config.corsAllowedOrigins
    );
  };

  const handleDeviceRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const route = resolveForwardableMobileRoute(req);
    const token = bearerToken(req.headers);
    if (!token) throw new HttpError(401, 'unauthorized', 'A valid mobile credential is required.');

    const authorized = await lovstudio.authorize({
      kind: 'mobile',
      token,
      deviceId: route.deviceId,
    });
    if (authorized.deviceId !== route.deviceId) {
      throw new HttpError(403, 'device_mismatch', 'Credential does not belong to this device.');
    }
    if (!registry.has(route.deviceId)) {
      throw new HttpError(503, 'desktop_offline', 'Yoda desktop is offline.');
    }

    const body = await readForwardBody(req, config.maxRequestBodyBytes, config.requestTimeoutMs);
    registry.forward(route.deviceId, {
      req,
      res,
      route,
      body,
      headers: sanitizedRequestHeaders(req.headers),
      responseHeaders: corsHeaders(req, config.corsAllowedOrigins) as Record<string, string>,
    });
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/health') {
        writeJson(
          req,
          res,
          200,
          { ok: true, service: 'yoda-relay', protocolVersion: 1 },
          config.corsAllowedOrigins
        );
        return;
      }

      if (req.method === 'OPTIONS') {
        if (!isCorsOriginAllowed(req, config.corsAllowedOrigins)) {
          throw new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed.');
        }
        const pathname = new URL(req.url ?? '/', 'http://relay.invalid').pathname;
        if (pathname !== '/v1/pair' && !pathname.startsWith('/v1/devices/')) {
          throw new HttpError(404, 'not_found', 'Relay endpoint was not found.');
        }
        res.writeHead(204, corsHeaders(req, config.corsAllowedOrigins));
        res.end();
        return;
      }

      if (!isCorsOriginAllowed(req, config.corsAllowedOrigins)) {
        throw new HttpError(403, 'origin_not_allowed', 'Request origin is not allowed.');
      }
      if (req.method === 'POST' && req.url === '/v1/pair') {
        await handlePair(req, res);
        return;
      }
      await handleDeviceRequest(req, res);
    })().catch((error: unknown) => {
      if (
        !(
          error instanceof HttpError ||
          error instanceof RoutePolicyError ||
          error instanceof ControlPlaneError
        )
      ) {
        console.error('Relay request failed', error);
      }
      writeApiError(req, res, asHttpError(error), config.corsAllowedOrigins);
    });
  });
  server.headersTimeout = Math.max(5_000, Math.min(30_000, config.requestTimeoutMs));
  server.requestTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = 5_000;

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const deviceId = resolveHostDeviceId(req);
      const token = bearerToken(req.headers);
      if (!token) throw new HttpError(401, 'unauthorized', 'A valid host credential is required.');
      const authorized = await lovstudio.authorize({ kind: 'host', token, deviceId });
      if (authorized.deviceId !== deviceId) {
        throw new HttpError(403, 'device_mismatch', 'Credential does not belong to this device.');
      }
      if (socket.destroyed) return;
      webSockets.handleUpgrade(req, socket, head, (webSocket) => {
        const reauthorizeTimer = setInterval(() => {
          void lovstudio.authorize({ kind: 'host', token, deviceId }).catch((error: unknown) => {
            const closeCode = hostAuthorizationCloseCode(error);
            if (closeCode !== null && webSocket.readyState === webSocket.OPEN) {
              webSocket.close(closeCode, 'Relay authorization expired');
            }
          });
        }, config.hostReauthorizeIntervalMs);
        reauthorizeTimer.unref?.();
        webSocket.once('close', () => clearInterval(reauthorizeTimer));
        registry.attach(deviceId, webSocket);
        webSockets.emit('connection', webSocket, req);
      });
    })().catch((error: unknown) => {
      const normalized = asHttpError(error);
      rejectUpgrade(socket, normalized.status);
    });
  });

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          const address = server.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Relay did not bind to a TCP address.'));
            return;
          }
          resolve({ host: address.address, port: address.port });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(config.port, config.host);
      }),
    close: async () => {
      registry.close();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
