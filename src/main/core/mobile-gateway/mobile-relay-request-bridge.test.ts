import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { MobileRelayRequestBridge } from './mobile-relay-request-bridge';

function socket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
  } as unknown as WebSocket;
}

describe('MobileRelayRequestBridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects paths outside the mobile API without touching loopback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const ws = socket();
    const bridge = new MobileRelayRequestBridge(() => ({
      baseUrl: 'http://127.0.0.1:3879',
      token: 'local-secret',
    }));
    bridge.handle(ws, {
      v: 1,
      type: 'request.start',
      requestId: '1',
      method: 'POST',
      path: '/rpc',
      headers: {},
    });
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalledOnce());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(ws.send).mock.calls[0][0] as string)).toMatchObject({
      type: 'response.error',
      code: 'route_not_allowed',
    });
  });

  it('strips the public authorization and injects the loopback token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'secret=1' },
      })
    );
    const ws = socket();
    const bridge = new MobileRelayRequestBridge(() => ({
      baseUrl: 'http://127.0.0.1:3879',
      token: 'local-secret',
    }));
    bridge.handle(ws, {
      v: 1,
      type: 'request.start',
      requestId: '2',
      method: 'GET',
      path: '/v1/snapshot',
      headers: {
        authorization: 'Bearer public-secret',
        cookie: 'bad=1',
        accept: 'application/json',
      },
    });
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(ws.send)
          .mock.calls.some(([value]) => JSON.parse(value as string).type === 'response.end')
      ).toBe(true)
    );
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer local-secret' });
    expect(init?.headers).not.toHaveProperty('cookie');
    const start = vi
      .mocked(ws.send)
      .mock.calls.map(([value]) => JSON.parse(value as string))
      .find((frame) => frame.type === 'response.start');
    expect(start.headers).not.toHaveProperty('set-cookie');
  });

  it('splits large loopback chunks into bounded Relay frames', async () => {
    const payload = new Uint8Array(160 * 1024).fill(65);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(payload));
    const ws = socket();
    const bridge = new MobileRelayRequestBridge(() => ({
      baseUrl: 'http://127.0.0.1:3879',
      token: 'local-secret',
    }));
    bridge.handle(ws, {
      v: 1,
      type: 'request.start',
      requestId: '3',
      method: 'GET',
      path: '/v1/snapshot',
      headers: {},
    });

    await vi.waitFor(() =>
      expect(
        vi
          .mocked(ws.send)
          .mock.calls.some(([value]) => JSON.parse(value as string).type === 'response.end')
      ).toBe(true)
    );
    const chunks = vi
      .mocked(ws.send)
      .mock.calls.map(([value]) => JSON.parse(value as string))
      .filter((frame) => frame.type === 'response.chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((frame) => frame.sequence)).toEqual(chunks.map((_, index) => index));
    expect(
      chunks.every((frame) => Buffer.from(frame.bodyBase64, 'base64').byteLength <= 64 * 1024)
    ).toBe(true);
    expect(
      chunks.reduce((total, frame) => total + Buffer.from(frame.bodyBase64, 'base64').byteLength, 0)
    ).toBe(payload.byteLength);
  });
});
