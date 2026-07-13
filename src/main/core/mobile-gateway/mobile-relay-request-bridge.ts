import type WebSocket from 'ws';
import {
  isAllowedMobileRelayRequest,
  MOBILE_RELAY_PROTOCOL_VERSION,
  type MobileRelayHostFrame,
  type MobileRelayResponseFrame,
} from '@shared/mobile-relay';
import { log } from '@main/lib/logger';

const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RELAY_RESPONSE_CHUNK_BYTES = 64 * 1024;
const MAX_RELAY_SOCKET_BUFFERED_BYTES = 1024 * 1024;
const FORWARDED_REQUEST_HEADERS = new Set(['accept', 'content-type', 'last-event-id']);
const FORWARDED_RESPONSE_HEADERS = new Set(['content-type', 'cache-control', 'x-accel-buffering']);

type LoopbackConnection = { baseUrl: string; token: string };

function send(socket: WebSocket, frame: MobileRelayResponseFrame): boolean {
  if (socket.readyState !== 1 || socket.bufferedAmount > MAX_RELAY_SOCKET_BUFFERED_BYTES) {
    return false;
  }
  socket.send(JSON.stringify(frame));
  return true;
}

function decodeBody(value: string | undefined): ArrayBuffer | undefined {
  if (!value) return undefined;
  const body = Buffer.from(value, 'base64');
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('request_too_large');
  return Uint8Array.from(body).buffer;
}

function requestHeaders(input: Record<string, string>, token: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  for (const [key, value] of Object.entries(input)) {
    if (FORWARDED_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = value;
  }
  return headers;
}

function responseHeaders(input: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  input.forEach((value, key) => {
    if (FORWARDED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value;
  });
  return headers;
}

export class MobileRelayRequestBridge {
  private readonly requests = new Map<string, AbortController>();

  constructor(private readonly loopback: () => LoopbackConnection | null) {}

  handle(socket: WebSocket, frame: MobileRelayHostFrame): void {
    if (frame.v !== MOBILE_RELAY_PROTOCOL_VERSION) return;
    if (frame.type === 'request.cancel') {
      this.requests.get(frame.requestId)?.abort();
      return;
    }
    void this.forward(socket, frame).catch((error) => {
      log.error('MobileRelay: unexpected request bridge failure', error);
    });
  }

  cancelAll(): void {
    for (const controller of this.requests.values()) controller.abort();
    this.requests.clear();
  }

  private async forward(
    socket: WebSocket,
    frame: Extract<MobileRelayHostFrame, { type: 'request.start' }>
  ): Promise<void> {
    if (this.requests.has(frame.requestId)) return;
    if (!isAllowedMobileRelayRequest(frame.method, frame.path)) {
      send(socket, {
        v: 1,
        type: 'response.error',
        requestId: frame.requestId,
        code: 'route_not_allowed',
        message: 'Relay route is not allowed.',
      });
      return;
    }
    const target = this.loopback();
    if (!target) {
      send(socket, {
        v: 1,
        type: 'response.error',
        requestId: frame.requestId,
        code: 'gateway_unavailable',
        message: 'Desktop mobile gateway is unavailable.',
      });
      return;
    }

    const controller = new AbortController();
    this.requests.set(frame.requestId, controller);
    try {
      const body = decodeBody(frame.bodyBase64);
      const response = await fetch(`${target.baseUrl}${frame.path}`, {
        method: frame.method,
        headers: requestHeaders(frame.headers, target.token),
        body,
        signal: controller.signal,
      });
      const headers = responseHeaders(response.headers);
      if (
        !send(socket, {
          v: 1,
          type: 'response.start',
          requestId: frame.requestId,
          status: response.status,
          headers,
        })
      ) {
        throw new Error('relay_backpressure');
      }

      const isEventStream = response.headers.get('content-type')?.includes('text/event-stream');
      let totalBytes = 0;
      let sequence = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (!isEventStream && totalBytes > MAX_JSON_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('response_too_large');
          }
          for (
            let offset = 0;
            offset < value.byteLength;
            offset += MAX_RELAY_RESPONSE_CHUNK_BYTES
          ) {
            const chunk = value.subarray(
              offset,
              Math.min(offset + MAX_RELAY_RESPONSE_CHUNK_BYTES, value.byteLength)
            );
            if (
              !send(socket, {
                v: 1,
                type: 'response.chunk',
                requestId: frame.requestId,
                sequence,
                bodyBase64: Buffer.from(chunk).toString('base64'),
              })
            ) {
              await reader.cancel();
              throw new Error('relay_backpressure');
            }
            sequence += 1;
          }
        }
      }
      if (!send(socket, { v: 1, type: 'response.end', requestId: frame.requestId })) {
        throw new Error('relay_backpressure');
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof Error ? error.message : 'bridge_failed';
      log.warn('MobileRelay: loopback request failed', { code, path: frame.path });
      if (code === 'relay_backpressure') {
        socket.close(1013, 'Relay backpressure');
        return;
      }
      send(socket, {
        v: 1,
        type: 'response.error',
        requestId: frame.requestId,
        code,
        message: 'Desktop request failed.',
      });
    } finally {
      this.requests.delete(frame.requestId);
    }
  }
}
