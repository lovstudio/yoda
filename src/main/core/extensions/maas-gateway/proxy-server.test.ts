import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMaasGatewayServer, type MaasGatewayServer } from './proxy-server';

describe('MaaS Gateway proxy server', () => {
  let upstream: http.Server;
  let upstreamPort: number;
  let gateway: MaasGatewayServer;
  let received:
    | {
        authorization: string | undefined;
        body: string;
        path: string | undefined;
        yodaToken: string | undefined;
      }
    | undefined;

  beforeEach(async () => {
    received = undefined;
    upstream = http.createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        received = {
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
          path: request.url,
          yodaToken: request.headers['x-yoda-maas-gateway-token'] as string | undefined,
        };
        response.writeHead(201, {
          'content-type': 'application/json',
          'x-upstream': 'reached',
        });
        response.end(JSON.stringify({ id: 'response-from-upstream' }));
      })();
    });
    await listen(upstream);
    upstreamPort = serverPort(upstream);

    gateway = await createMaasGatewayServer({ admissionToken: 'local-admission-token' });
    gateway.setConfiguration({
      providerId: 'zenmux',
      endpoint: `http://127.0.0.1:${upstreamPort}/v1`,
      apiKey: 'real-upstream-secret',
    });
  });

  afterEach(async () => {
    await gateway.close();
    await close(upstream);
  });

  it('requires a local admission token while keeping health checks available', async () => {
    const health = await fetch(`http://127.0.0.1:${gateway.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      configured: true,
      providerId: 'zenmux',
    });

    const unauthorized = await fetch(`http://127.0.0.1:${gateway.port}/v1/responses`);
    expect(unauthorized.status).toBe(401);
    expect(received).toBeUndefined();
  });

  it('injects the upstream key and forwards the Responses API request', async () => {
    const response = await fetch(`http://127.0.0.1:${gateway.port}/v1/responses?stream=false`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer client-provided-token',
        'Content-Type': 'application/json',
        'X-Yoda-Maas-Gateway-Token': 'local-admission-token',
      },
      body: JSON.stringify({ model: 'gpt-test', input: 'hello' }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('x-upstream')).toBe('reached');
    expect(await response.json()).toEqual({ id: 'response-from-upstream' });
    expect(received).toEqual({
      authorization: 'Bearer real-upstream-secret',
      body: JSON.stringify({ model: 'gpt-test', input: 'hello' }),
      path: '/v1/responses?stream=false',
      yodaToken: undefined,
    });
  });
});

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function serverPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server has no TCP port.');
  return address.port;
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}
