import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import WebSocket, { type RawData } from 'ws';
import { RELAY_HOST_CLOSE_CODE } from './close-codes.js';
import type { RelayConfig } from './config.js';
import { sanitizedResponseHeaders, securityHeaders } from './headers.js';
import { HttpError, writeApiError } from './http-utils.js';
import {
  decodeBase64,
  encodeRelayFrame,
  parseHostInboundFrame,
  ProtocolError,
  RELAY_PROTOCOL_VERSION,
  type HostInboundFrame,
  type RelayRequestCancelFrame,
  type RelayRequestStartFrame,
} from './protocol.js';
import type { ForwardableMobileRoute } from './route-policy.js';

export type ForwardRequest = {
  req: IncomingMessage;
  res: ServerResponse;
  route: ForwardableMobileRoute;
  body: Buffer;
  headers: Record<string, string>;
  responseHeaders: Record<string, string>;
};

type Exchange = ForwardRequest & {
  requestId: string;
  responseStarted: boolean;
  responseIsEventStream: boolean;
  bufferedResponse: {
    status: number;
    headers: Record<string, string>;
    chunks: Buffer[];
  } | null;
  expectedSequence: number;
  responseBytes: number;
  timer: NodeJS.Timeout | null;
  settled: boolean;
  onClientClose: () => void;
};

type RegistryOptions = Pick<
  RelayConfig,
  | 'maxConcurrentRequestsPerDevice'
  | 'maxConcurrentStreamsPerDevice'
  | 'maxFrameBytes'
  | 'maxResponseBytes'
  | 'maxWsBufferedBytes'
  | 'requestTimeoutMs'
  | 'streamIdleTimeoutMs'
  | 'wsHeartbeatIntervalMs'
> & {
  corsAllowedOrigins: readonly string[];
};

class HostConnection {
  private readonly exchanges = new Map<string, Exchange>();
  private activeStreams = 0;
  private alive = true;
  private closed = false;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly maxChunkBytes: number;

  constructor(
    readonly deviceId: string,
    private readonly socket: WebSocket,
    private readonly options: RegistryOptions,
    private readonly onClosed: (connection: HostConnection) => void
  ) {
    // Base64 expands by 4/3 and the JSON envelope adds overhead. Keeping decoded chunks at most
    // half the WebSocket payload limit guarantees a valid frame even with long request IDs/headers.
    this.maxChunkBytes = Math.max(1, Math.floor(options.maxFrameBytes / 2));
    socket.on('message', this.handleMessage);
    socket.on('pong', this.handlePong);
    socket.once('close', this.handleClose);
    socket.once('error', this.handleSocketError);
    this.heartbeatTimer = setInterval(this.heartbeat, options.wsHeartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === WebSocket.OPEN;
  }

  forward(input: ForwardRequest): void {
    if (!this.isOpen) {
      writeApiError(
        input.req,
        input.res,
        new HttpError(503, 'desktop_offline', 'Yoda desktop is offline.'),
        this.options.corsAllowedOrigins
      );
      return;
    }
    if (this.exchanges.size >= this.options.maxConcurrentRequestsPerDevice) {
      writeApiError(
        input.req,
        input.res,
        new HttpError(429, 'device_busy', 'Yoda desktop has too many active Relay requests.'),
        this.options.corsAllowedOrigins
      );
      return;
    }
    if (
      input.route.isEventStream &&
      this.activeStreams >= this.options.maxConcurrentStreamsPerDevice
    ) {
      writeApiError(
        input.req,
        input.res,
        new HttpError(429, 'stream_limit', 'Yoda desktop has too many active Relay streams.'),
        this.options.corsAllowedOrigins
      );
      return;
    }
    if (this.socket.bufferedAmount > this.options.maxWsBufferedBytes) {
      writeApiError(
        input.req,
        input.res,
        new HttpError(503, 'relay_backpressure', 'Yoda desktop connection is congested.'),
        this.options.corsAllowedOrigins
      );
      return;
    }

    const requestId = randomUUID();
    const exchange: Exchange = {
      ...input,
      requestId,
      responseStarted: false,
      responseIsEventStream: false,
      bufferedResponse: null,
      expectedSequence: 0,
      responseBytes: 0,
      timer: null,
      settled: false,
      onClientClose: () => this.handleClientClose(requestId),
    };
    this.exchanges.set(requestId, exchange);
    if (input.route.isEventStream) this.activeStreams += 1;
    input.req.once('aborted', exchange.onClientClose);
    input.res.once('close', exchange.onClientClose);
    this.armTimeout(exchange, this.options.requestTimeoutMs);

    const frame: RelayRequestStartFrame = {
      v: RELAY_PROTOCOL_VERSION,
      type: 'request.start',
      requestId,
      method: input.req.method === 'POST' ? 'POST' : 'GET',
      path: input.route.upstreamPath,
      headers: input.headers,
      ...(input.body.length > 0 ? { bodyBase64: input.body.toString('base64') } : {}),
    };
    this.send(frame, (error) => {
      if (error) this.fail(exchange, 503, 'desktop_disconnected', 'Yoda desktop disconnected.');
    });
  }

  close(code = 1001, reason = 'Relay connection closed'): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    for (const exchange of [...this.exchanges.values()]) {
      this.fail(exchange, 503, 'desktop_offline', 'Yoda desktop is offline.');
    }
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close(code, reason.slice(0, 123));
    }
    this.detachSocketListeners();
    this.onClosed(this);
  }

  private handleMessage = (data: RawData, isBinary: boolean): void => {
    if (isBinary) {
      this.socket.close(1008, 'Text frames required');
      return;
    }
    let frame: HostInboundFrame;
    try {
      frame = parseHostInboundFrame(data.toString('utf8'), this.maxChunkBytes);
    } catch (error) {
      const reason = error instanceof ProtocolError ? error.message : 'Invalid host frame.';
      this.socket.close(1008, reason.slice(0, 123));
      return;
    }

    const exchange = this.exchanges.get(frame.requestId);
    if (!exchange || exchange.settled) return;
    try {
      this.applyFrame(exchange, frame);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Invalid response sequence.';
      this.fail(
        exchange,
        502,
        'invalid_host_response',
        'Yoda desktop returned an invalid response.'
      );
      this.socket.close(1008, reason.slice(0, 123));
    }
  };

  private applyFrame(exchange: Exchange, frame: HostInboundFrame): void {
    switch (frame.type) {
      case 'response.start':
        if (exchange.responseStarted) throw new ProtocolError('Duplicate response.start frame.');
        this.startResponse(exchange, frame.status, frame.headers);
        return;
      case 'response.chunk': {
        if (!exchange.responseStarted)
          throw new ProtocolError('response.chunk arrived before start.');
        if (frame.sequence !== exchange.expectedSequence) {
          throw new ProtocolError('response.chunk sequence is out of order.');
        }
        exchange.expectedSequence += 1;
        const chunk = decodeBase64(frame.bodyBase64, this.maxChunkBytes);
        if (!exchange.responseIsEventStream) {
          exchange.responseBytes += chunk.length;
          if (exchange.responseBytes > this.options.maxResponseBytes) {
            this.cancel(exchange, 'backpressure');
            this.fail(
              exchange,
              502,
              'response_too_large',
              'Yoda desktop response exceeded the Relay limit.'
            );
            return;
          }
          if (!exchange.bufferedResponse) {
            throw new ProtocolError('Buffered response metadata is missing.');
          }
          exchange.bufferedResponse.chunks.push(chunk);
        } else {
          this.armTimeout(exchange, this.options.streamIdleTimeoutMs);
          // SSE responses are intentionally unbounded. Treat a full HTTP write buffer as the
          // slow-client limit for streams, while bounded JSON responses are buffered separately.
          if (!exchange.res.write(chunk)) {
            this.cancel(exchange, 'backpressure');
            this.detach(exchange);
            exchange.res.destroy(new Error('Relay response backpressure limit reached.'));
          }
        }
        return;
      }
      case 'response.end':
        if (!exchange.responseStarted)
          throw new ProtocolError('response.end arrived before start.');
        if (!exchange.responseIsEventStream) this.writeBufferedResponse(exchange);
        this.detach(exchange);
        if (!exchange.res.destroyed && !exchange.res.writableEnded) exchange.res.end();
        return;
      case 'response.error':
        this.fail(exchange, 502, 'desktop_gateway_error', 'Yoda desktop gateway failed.');
        return;
    }
  }

  private startResponse(
    exchange: Exchange,
    status: number,
    hostHeaders: Record<string, string>
  ): void {
    const headers = sanitizedResponseHeaders(hostHeaders);
    const contentType = headers['content-type']?.toLowerCase() ?? '';
    const successful = status >= 200 && status < 300;
    if (
      exchange.route.isEventStream &&
      successful &&
      !contentType.startsWith('text/event-stream')
    ) {
      throw new ProtocolError('Event route did not return text/event-stream.');
    }
    exchange.responseStarted = true;
    exchange.responseIsEventStream = exchange.route.isEventStream && successful;
    if (exchange.responseIsEventStream) {
      headers['cache-control'] = 'no-cache, no-transform';
      headers.connection = 'keep-alive';
      headers['x-accel-buffering'] = 'no';
      this.armTimeout(exchange, this.options.streamIdleTimeoutMs);
    } else if (!headers['cache-control']) {
      headers['cache-control'] = 'no-store';
    }
    const responseHeaders = {
      ...securityHeaders(),
      ...exchange.responseHeaders,
      ...headers,
    };
    if (exchange.responseIsEventStream) {
      exchange.res.writeHead(status, responseHeaders);
      exchange.res.flushHeaders();
    } else {
      exchange.bufferedResponse = { status, headers: responseHeaders, chunks: [] };
    }
  }

  private writeBufferedResponse(exchange: Exchange): void {
    const buffered = exchange.bufferedResponse;
    if (!buffered) throw new ProtocolError('Buffered response metadata is missing.');
    const body = Buffer.concat(buffered.chunks, exchange.responseBytes);
    exchange.res.writeHead(buffered.status, {
      ...buffered.headers,
      'content-length': String(body.length),
    });
    exchange.res.end(body);
  }

  private handleClientClose(requestId: string): void {
    const exchange = this.exchanges.get(requestId);
    if (!exchange || exchange.settled || exchange.res.writableEnded) return;
    this.cancel(exchange, 'client-disconnected');
    this.detach(exchange);
  }

  private armTimeout(exchange: Exchange, timeoutMs: number): void {
    if (exchange.timer) clearTimeout(exchange.timer);
    exchange.timer = setTimeout(() => {
      this.cancel(exchange, 'timeout');
      this.fail(exchange, 504, 'desktop_timeout', 'Yoda desktop did not respond in time.');
    }, timeoutMs);
    exchange.timer.unref?.();
  }

  private cancel(exchange: Exchange, reason: RelayRequestCancelFrame['reason']): void {
    if (!this.isOpen) return;
    this.send({
      v: RELAY_PROTOCOL_VERSION,
      type: 'request.cancel',
      requestId: exchange.requestId,
      reason,
    });
  }

  private fail(exchange: Exchange, status: number, code: string, message: string): void {
    if (exchange.settled) return;
    const responseStarted = exchange.res.headersSent;
    this.detach(exchange);
    if (exchange.res.destroyed || exchange.res.writableEnded) return;
    if (responseStarted) {
      exchange.res.end();
      return;
    }
    writeApiError(
      exchange.req,
      exchange.res,
      new HttpError(status, code, message),
      this.options.corsAllowedOrigins
    );
  }

  private detach(exchange: Exchange): void {
    if (exchange.settled) return;
    exchange.settled = true;
    if (exchange.timer) clearTimeout(exchange.timer);
    exchange.timer = null;
    exchange.req.removeListener('aborted', exchange.onClientClose);
    exchange.res.removeListener('close', exchange.onClientClose);
    this.exchanges.delete(exchange.requestId);
    if (exchange.route.isEventStream) this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  private send(
    frame: RelayRequestStartFrame | RelayRequestCancelFrame,
    callback?: (error?: Error) => void
  ) {
    if (!this.isOpen) {
      callback?.(new Error('Host WebSocket is not open.'));
      return;
    }
    try {
      this.socket.send(encodeRelayFrame(frame), (error) => callback?.(error ?? undefined));
    } catch (error) {
      callback?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handlePong = (): void => {
    this.alive = true;
  };

  private heartbeat = (): void => {
    if (!this.isOpen) return;
    if (!this.alive) {
      this.socket.terminate();
      return;
    }
    this.alive = false;
    this.socket.ping();
  };

  private handleSocketError = (): void => this.close(1011, 'Host WebSocket error');

  private handleClose = (): void => {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    for (const exchange of [...this.exchanges.values()]) {
      this.fail(exchange, 503, 'desktop_offline', 'Yoda desktop is offline.');
    }
    this.detachSocketListeners();
    this.onClosed(this);
  };

  private detachSocketListeners(): void {
    this.socket.removeListener('message', this.handleMessage);
    this.socket.removeListener('pong', this.handlePong);
    this.socket.removeListener('close', this.handleClose);
    this.socket.removeListener('error', this.handleSocketError);
  }
}

export class HostRegistry {
  private readonly connections = new Map<string, HostConnection>();

  constructor(private readonly options: RegistryOptions) {}

  attach(deviceId: string, socket: WebSocket): void {
    const existing = this.connections.get(deviceId);
    const connection = new HostConnection(deviceId, socket, this.options, (closed) => {
      if (this.connections.get(deviceId) === closed) this.connections.delete(deviceId);
    });
    this.connections.set(deviceId, connection);
    existing?.close(RELAY_HOST_CLOSE_CODE.replaced, 'Replaced by a newer host connection');
  }

  forward(deviceId: string, input: ForwardRequest): void {
    const connection = this.connections.get(deviceId);
    if (!connection?.isOpen) {
      writeApiError(
        input.req,
        input.res,
        new HttpError(503, 'desktop_offline', 'Yoda desktop is offline.'),
        this.options.corsAllowedOrigins
      );
      return;
    }
    connection.forward(input);
  }

  has(deviceId: string): boolean {
    return this.connections.get(deviceId)?.isOpen ?? false;
  }

  close(): void {
    for (const connection of [...this.connections.values()]) {
      connection.close(1001, 'Relay shutting down');
    }
    this.connections.clear();
  }
}
