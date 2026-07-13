import { describe, expect, it } from 'vitest';
import { parseHostInboundFrame, ProtocolError } from './protocol.js';

describe('Relay host protocol', () => {
  it('parses a bounded response chunk', () => {
    expect(
      parseHostInboundFrame(
        JSON.stringify({
          v: 1,
          type: 'response.chunk',
          requestId: 'request-1',
          sequence: 0,
          bodyBase64: Buffer.from('中文').toString('base64'),
        }),
        64
      )
    ).toMatchObject({
      type: 'response.chunk',
      requestId: 'request-1',
      sequence: 0,
    });
  });

  it.each([
    '{',
    JSON.stringify({ v: 2, type: 'response.end', requestId: 'request-1' }),
    JSON.stringify({
      v: 1,
      type: 'response.chunk',
      requestId: '../bad',
      sequence: 0,
      bodyBase64: '',
    }),
    JSON.stringify({ v: 1, type: 'response.chunk', requestId: 'ok', sequence: 0, bodyBase64: '!' }),
    JSON.stringify({
      v: 1,
      type: 'response.start',
      requestId: 'ok',
      status: 200,
      headers: { x: 'a\r\nb' },
    }),
  ])('rejects malformed host frames', (raw) => {
    expect(() => parseHostInboundFrame(raw, 64)).toThrow(ProtocolError);
  });
});
