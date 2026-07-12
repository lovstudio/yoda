import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { bearerToken, sanitizedRequestHeaders, sanitizedResponseHeaders } from './headers.js';

describe('Relay header policy', () => {
  it('extracts only a strict bearer token', () => {
    expect(bearerToken({ authorization: 'Bearer token-1' })).toBe('token-1');
    expect(bearerToken({ authorization: 'Bearer token-1, Bearer token-2' })).toBeNull();
    expect(bearerToken({ authorization: 'Basic secret' })).toBeNull();
  });

  it('never forwards caller credentials or hop-by-hop request headers', () => {
    const headers: IncomingHttpHeaders = {
      accept: 'text/event-stream',
      authorization: 'Bearer secret',
      connection: 'upgrade',
      cookie: 'session=secret',
      'content-type': 'application/json',
      'last-event-id': 'event:1',
      host: 'relay.example',
    };
    expect(sanitizedRequestHeaders(headers)).toEqual({
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'last-event-id': 'event:1',
    });
  });

  it('keeps safe response metadata and drops cookies and public CORS headers', () => {
    expect(
      sanitizedResponseHeaders({
        'Content-Type': 'application/json',
        'Set-Cookie': 'secret=1',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
        'X-Bad': 'one\r\ntwo',
      })
    ).toEqual({
      'content-type': 'application/json',
      'x-accel-buffering': 'no',
    });
  });
});
