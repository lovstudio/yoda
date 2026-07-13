import { describe, expect, it } from 'vitest';
import {
  encodeMobileServerSentEvent,
  MOBILE_SESSION_EVENT_NAME,
  MobileServerSentEventParser,
  parseMobileSessionInvalidation,
} from './mobile-session-events';

describe('mobile session server-sent events', () => {
  it('encodes and parses a session invalidation split across chunks', () => {
    const encoded = encodeMobileServerSentEvent({
      id: 'gateway:1',
      event: MOBILE_SESSION_EVENT_NAME,
      retry: 1_000,
      data: JSON.stringify({
        version: 1,
        conversationId: '会话-1',
        reason: 'transcript-changed',
        emittedAt: '2026-07-11T10:00:00.000Z',
      }),
    });
    const parser = new MobileServerSentEventParser();

    expect(parser.push(encoded.slice(0, 17))).toEqual([]);
    const [frame] = parser.push(encoded.slice(17));

    expect(frame).toMatchObject({
      id: 'gateway:1',
      event: MOBILE_SESSION_EVENT_NAME,
      retry: 1_000,
    });
    expect(frame && parseMobileSessionInvalidation(frame)).toEqual({
      version: 1,
      conversationId: '会话-1',
      reason: 'transcript-changed',
      emittedAt: '2026-07-11T10:00:00.000Z',
    });
  });

  it('supports CRLF, multiple data lines, and multiple frames in one chunk', () => {
    const parser = new MobileServerSentEventParser();
    const frames = parser.push(
      'event: first\r\ndata: line one\r\ndata: line two\r\n\r\n' + 'event: second\ndata: done\n\n'
    );

    expect(frames).toEqual([
      { event: 'first', id: undefined, retry: undefined, data: 'line one\nline two' },
      { event: 'second', id: undefined, retry: undefined, data: 'done' },
    ]);
  });

  it('preserves multibyte text when transport chunks split UTF-8 characters', () => {
    const encoded = new TextEncoder().encode(
      encodeMobileServerSentEvent({
        event: MOBILE_SESSION_EVENT_NAME,
        data: JSON.stringify({
          version: 1,
          conversationId: '中文会话',
          reason: 'connected',
          emittedAt: 'now',
        }),
      })
    );
    const decoder = new TextDecoder();
    const parser = new MobileServerSentEventParser();
    const frames = [];
    for (const byte of encoded) {
      frames.push(...parser.push(decoder.decode(Uint8Array.of(byte), { stream: true })));
    }
    frames.push(...parser.push(decoder.decode()));

    expect(frames).toHaveLength(1);
    expect(parseMobileSessionInvalidation(frames[0]!)).toMatchObject({
      conversationId: '中文会话',
    });
  });

  it('ignores heartbeats and isolates malformed payloads', () => {
    const parser = new MobileServerSentEventParser();
    const frames = parser.push(
      ': heartbeat\n\n' +
        `event: ${MOBILE_SESSION_EVENT_NAME}\ndata: not-json\n\n` +
        `event: ${MOBILE_SESSION_EVENT_NAME}\ndata: {"version":1,"conversationId":"c","reason":"status-changed","emittedAt":"now","runtimeStatus":"completed"}\n\n`
    );

    expect(frames).toHaveLength(2);
    expect(parseMobileSessionInvalidation(frames[0]!)).toBeNull();
    expect(parseMobileSessionInvalidation(frames[1]!)).toMatchObject({
      conversationId: 'c',
      reason: 'status-changed',
      runtimeStatus: 'completed',
    });
  });
});
