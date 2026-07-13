import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_SESSION_HEARTBEAT_INTERVAL_MS,
  MobileSessionEventStream,
} from './mobile-session-event-stream';

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  flushed = false;
  acceptsWrites = true;

  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status;
    this.headers = headers;
    return this;
  }

  flushHeaders(): void {
    this.flushed = true;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.acceptsWrites;
  }

  end(): this {
    this.writableEnded = true;
    return this;
  }
}

function createRequest(): http.IncomingMessage {
  const request = new EventEmitter() as EventEmitter & {
    socket: { setTimeout: ReturnType<typeof vi.fn>; setKeepAlive: ReturnType<typeof vi.fn> };
  };
  request.socket = { setTimeout: vi.fn(), setKeepAlive: vi.fn() };
  return request as unknown as http.IncomingMessage;
}

describe('MobileSessionEventStream', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes SSE headers, invalidations, heartbeats, and cleans up once', () => {
    vi.useFakeTimers();
    const request = createRequest();
    const response = new FakeResponse();
    const onClose = vi.fn();
    let sequence = 0;
    const stream = new MobileSessionEventStream(
      request,
      response as unknown as http.ServerResponse,
      () => `epoch:${++sequence}`,
      onClose
    );

    expect(stream.start()).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers['Cache-Control']).toBe('no-cache, no-transform');
    expect(response.flushed).toBe(true);

    stream.send({
      version: 1,
      conversationId: 'conversation',
      reason: 'connected',
      emittedAt: 'now',
    });
    expect(response.chunks[0]).toContain('id: epoch:1\nevent: session-invalidated\n');
    expect(response.chunks[0]).toContain('"reason":"connected"');

    vi.advanceTimersByTime(MOBILE_SESSION_HEARTBEAT_INTERVAL_MS);
    expect(response.chunks[1]).toMatch(/^: heartbeat \d+\n\n$/);
    expect(sequence).toBe(1);

    response.destroyed = true;
    response.emit('close');
    stream.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(response.writableEnded).toBe(false);

    vi.advanceTimersByTime(MOBILE_SESSION_HEARTBEAT_INTERVAL_MS);
    expect(response.chunks).toHaveLength(2);
  });

  it('closes instead of buffering more events when the response applies backpressure', () => {
    const request = createRequest();
    const response = new FakeResponse();
    response.acceptsWrites = false;
    const onClose = vi.fn();
    const stream = new MobileSessionEventStream(
      request,
      response as unknown as http.ServerResponse,
      () => 'epoch:1',
      onClose
    );

    stream.start();
    expect(
      stream.send({
        version: 1,
        conversationId: 'conversation',
        reason: 'transcript-changed',
        emittedAt: 'now',
      })
    ).toBe(false);
    expect(stream.isClosed).toBe(true);
    expect(response.writableEnded).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
