import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { RELAY_HOST_CLOSE_CODE } from './close-codes.js';
import {
  DEFAULT_CONTROL_PLANE_TIMEOUT_MS,
  DEFAULT_HOST_REAUTHORIZE_INTERVAL_MS,
  DEFAULT_MAX_CONCURRENT_REQUESTS,
  DEFAULT_MAX_CONCURRENT_STREAMS,
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_WS_BUFFERED_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
  type RelayConfig,
} from './config.js';
import { ControlPlaneError, type LovStudioControlPlane } from './lovstudio-client.js';
import { createRelayServer, type RelayServer } from './relay-server.js';

const DEVICE_ID = 'desktop-1';
const HOST_TOKEN = 'host-token';
const MOBILE_TOKEN = 'mobile-token';
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

function config(overrides: Partial<RelayConfig> = {}): RelayConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    publicBaseUrl: 'https://relay.example',
    lovstudioBaseUrl: 'https://lovstudio.example',
    lovstudioServiceToken: 'service-token',
    lovstudioAuthorizePath: '/internal/authorize',
    lovstudioPairPath: '/internal/pair',
    corsAllowedOrigins: ['https://mobile.example'],
    maxRequestBodyBytes: DEFAULT_MAX_REQUEST_BODY_BYTES,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    maxFrameBytes: DEFAULT_MAX_FRAME_BYTES,
    maxConcurrentRequestsPerDevice: DEFAULT_MAX_CONCURRENT_REQUESTS,
    maxConcurrentStreamsPerDevice: DEFAULT_MAX_CONCURRENT_STREAMS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    controlPlaneTimeoutMs: DEFAULT_CONTROL_PLANE_TIMEOUT_MS,
    wsHeartbeatIntervalMs: DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
    hostReauthorizeIntervalMs: DEFAULT_HOST_REAUTHORIZE_INTERVAL_MS,
    maxWsBufferedBytes: DEFAULT_MAX_WS_BUFFERED_BYTES,
    ...overrides,
  };
}

function controlPlane(): LovStudioControlPlane & {
  authorize: ReturnType<typeof vi.fn<LovStudioControlPlane['authorize']>>;
  pair: ReturnType<typeof vi.fn<LovStudioControlPlane['pair']>>;
} {
  return {
    authorize: vi.fn<LovStudioControlPlane['authorize']>(async ({ kind, token, deviceId }) => {
      const expected = kind === 'host' ? HOST_TOKEN : MOBILE_TOKEN;
      if (token !== expected) {
        throw new ControlPlaneError(401, 'invalid_credential', 'Relay credential is invalid.');
      }
      return { accountId: 'account-1', deviceId };
    }),
    pair: vi.fn<LovStudioControlPlane['pair']>(async ({ deviceId, pairingCode }) => {
      if (pairingCode !== 'pair-once') {
        throw new ControlPlaneError(410, 'pairing_expired', 'Pairing code has expired.');
      }
      return { deviceId, mobileToken: MOBILE_TOKEN };
    }),
  };
}

async function startRelay(
  options: {
    config?: Partial<RelayConfig>;
    controlPlane?: LovStudioControlPlane;
  } = {}
): Promise<{ relay: RelayServer; httpBaseUrl: string; wsBaseUrl: string }> {
  const relay = createRelayServer({
    config: config(options.config),
    controlPlane: options.controlPlane ?? controlPlane(),
  });
  const address = await relay.listen();
  cleanup.push(() => relay.close());
  return {
    relay,
    httpBaseUrl: `http://127.0.0.1:${address.port}`,
    wsBaseUrl: `ws://127.0.0.1:${address.port}`,
  };
}

async function connectHost(wsBaseUrl: string): Promise<WebSocket> {
  const socket = new WebSocket(`${wsBaseUrl}/v1/host/${DEVICE_ID}`, {
    headers: { Authorization: `Bearer ${HOST_TOKEN}` },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function sendJsonResponse(
  socket: WebSocket,
  requestId: string,
  body: string,
  headers: Record<string, string> = {},
  status = 200
): void {
  socket.send(
    JSON.stringify({
      v: 1,
      type: 'response.start',
      requestId,
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    })
  );
  socket.send(
    JSON.stringify({
      v: 1,
      type: 'response.chunk',
      requestId,
      sequence: 0,
      bodyBase64: Buffer.from(body).toString('base64'),
    })
  );
  socket.send(JSON.stringify({ v: 1, type: 'response.end', requestId }));
}

describe('Yoda Relay server', () => {
  it('exchanges a one-time pairing code through LovStudio', async () => {
    const lovstudio = controlPlane();
    const { httpBaseUrl } = await startRelay({ controlPlane: lovstudio });
    const response = await fetch(`${httpBaseUrl}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DEVICE_ID, pairingCode: 'pair-once' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deviceId: DEVICE_ID,
      baseUrl: `https://relay.example/v1/devices/${DEVICE_ID}`,
      token: MOBILE_TOKEN,
    });
    expect(lovstudio.pair).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      pairingCode: 'pair-once',
    });
  });

  it('bridges an authenticated JSON request while filtering sensitive headers', async () => {
    const lovstudio = controlPlane();
    const { httpBaseUrl, wsBaseUrl } = await startRelay({ controlPlane: lovstudio });
    const host = await connectHost(wsBaseUrl);
    const requestFrame = new Promise<Record<string, unknown>>((resolve) => {
      host.once('message', (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        resolve(frame);
        sendJsonResponse(host, String(frame.requestId), '{"ok":true}', {
          'Set-Cookie': 'must-not-leak=1',
          'Access-Control-Allow-Origin': '*',
        });
      });
    });

    const response = await fetch(`${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/snapshot`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${MOBILE_TOKEN}`,
        Cookie: 'must-not-forward=1',
        Origin: 'https://mobile.example',
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe('https://mobile.example');
    await expect(requestFrame).resolves.toMatchObject({
      v: 1,
      type: 'request.start',
      method: 'GET',
      path: '/v1/snapshot',
      headers: { accept: 'application/json' },
    });
    expect(lovstudio.authorize).toHaveBeenCalledWith({
      kind: 'host',
      token: HOST_TOKEN,
      deviceId: DEVICE_ID,
    });
    expect(lovstudio.authorize).toHaveBeenCalledWith({
      kind: 'mobile',
      token: MOBILE_TOKEN,
      deviceId: DEVICE_ID,
    });
  });

  it('periodically reauthorizes a connected host', async () => {
    const lovstudio = controlPlane();
    const { wsBaseUrl } = await startRelay({
      controlPlane: lovstudio,
      config: { hostReauthorizeIntervalMs: 20 },
    });
    const host = await connectHost(wsBaseUrl);
    await vi.waitFor(
      () =>
        expect(
          lovstudio.authorize.mock.calls.filter(([input]) => input.kind === 'host').length
        ).toBeGreaterThan(1),
      { timeout: 500 }
    );
    host.close();
  });

  it('replaces an older host without using the credential-rejection close code', async () => {
    const { wsBaseUrl } = await startRelay();
    const first = await connectHost(wsBaseUrl);
    const firstClosed = new Promise<number>((resolve) => {
      first.once('close', (code) => resolve(code));
    });

    const second = await connectHost(wsBaseUrl);

    await expect(firstClosed).resolves.toBe(RELAY_HOST_CLOSE_CODE.replaced);
    expect(RELAY_HOST_CLOSE_CODE.replaced).not.toBe(RELAY_HOST_CLOSE_CODE.credentialRejected);
    expect(second.readyState).toBe(WebSocket.OPEN);
    second.close();
  });

  it('preserves SSE chunks over the framed bridge', async () => {
    const { httpBaseUrl, wsBaseUrl } = await startRelay();
    const host = await connectHost(wsBaseUrl);
    host.once('message', (data) => {
      const request = JSON.parse(data.toString()) as { requestId: string };
      host.send(
        JSON.stringify({
          v: 1,
          type: 'response.start',
          requestId: request.requestId,
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        })
      );
      ['event: session-invalidated\ndata: {"reason":"connected"}\n\n', ': heartbeat\n\n'].forEach(
        (chunk, sequence) =>
          host.send(
            JSON.stringify({
              v: 1,
              type: 'response.chunk',
              requestId: request.requestId,
              sequence,
              bodyBase64: Buffer.from(chunk).toString('base64'),
            })
          )
      );
      host.send(JSON.stringify({ v: 1, type: 'response.end', requestId: request.requestId }));
    });

    const response = await fetch(
      `${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/projects/p/tasks/t/sessions/s/events`,
      { headers: { Authorization: `Bearer ${MOBILE_TOKEN}` } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    await expect(response.text()).resolves.toBe(
      'event: session-invalidated\ndata: {"reason":"connected"}\n\n: heartbeat\n\n'
    );
  });

  it('forwards bounded JSON errors from event routes without disconnecting the host', async () => {
    const { httpBaseUrl, wsBaseUrl } = await startRelay();
    const host = await connectHost(wsBaseUrl);
    let requestCount = 0;
    host.on('message', (data) => {
      const request = JSON.parse(data.toString()) as { type: string; requestId: string };
      if (request.type !== 'request.start') return;
      requestCount += 1;
      if (requestCount === 1) {
        sendJsonResponse(host, request.requestId, '{"error":"not found"}', {}, 404);
      } else {
        sendJsonResponse(host, request.requestId, '{"ok":true}');
      }
    });

    const missing = await fetch(
      `${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/projects/p/tasks/t/sessions/missing/events`,
      { headers: { Authorization: `Bearer ${MOBILE_TOKEN}` } }
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'not found' });
    expect(host.readyState).toBe(WebSocket.OPEN);

    const next = await fetch(`${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/snapshot`, {
      headers: { Authorization: `Bearer ${MOBILE_TOKEN}` },
    });
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toEqual({ ok: true });
  });

  it('enforces per-device concurrency and cancels timed-out requests', async () => {
    const { httpBaseUrl, wsBaseUrl } = await startRelay({
      config: { maxConcurrentRequestsPerDevice: 1, requestTimeoutMs: 100 },
    });
    const host = await connectHost(wsBaseUrl);
    let firstRequestId = '';
    const firstStarted = new Promise<void>((resolve) => {
      host.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as {
          type: string;
          requestId: string;
          reason?: string;
        };
        if (frame.type === 'request.start' && !firstRequestId) {
          firstRequestId = frame.requestId;
          resolve();
        }
      });
    });
    const firstResponsePromise = fetch(`${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/snapshot`, {
      headers: { Authorization: `Bearer ${MOBILE_TOKEN}` },
    });
    await firstStarted;

    const secondResponse = await fetch(`${httpBaseUrl}/v1/devices/${DEVICE_ID}/v1/snapshot`, {
      headers: { Authorization: `Bearer ${MOBILE_TOKEN}` },
    });
    expect(secondResponse.status).toBe(429);

    const cancelFrame = new Promise<Record<string, unknown>>((resolve) => {
      const listener = (data: WebSocket.RawData) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        if (frame.type === 'request.cancel' && frame.requestId === firstRequestId) {
          host.off('message', listener);
          resolve(frame);
        }
      };
      host.on('message', listener);
    });
    const firstResponse = await firstResponsePromise;
    expect(firstResponse.status).toBe(504);
    await expect(cancelFrame).resolves.toMatchObject({
      type: 'request.cancel',
      requestId: firstRequestId,
      reason: 'timeout',
    });
  });
});
