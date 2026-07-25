import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexMaasProxy } from './codex-maas-proxy';

const openServers = new Set<http.Server>();
const openProxies = new Set<CodexMaasProxy>();

afterEach(async () => {
  await Promise.all([...openProxies].map((proxy) => proxy.close()));
  await Promise.all(
    [...openServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
  openProxies.clear();
  openServers.clear();
});

describe('Codex MaaS proxy', () => {
  it('keeps caller auth local and replaces it with the MaaS key upstream', async () => {
    let received:
      | { authorization: string | undefined; path: string | undefined; body: string }
      | undefined;
    const upstream = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = {
          authorization: request.headers.authorization,
          path: request.url,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end('data: {"type":"response.completed"}\n\n');
      });
    });
    openServers.add(upstream);
    await listen(upstream);
    const upstreamAddress = upstream.address() as AddressInfo;

    const proxy = new CodexMaasProxy();
    openProxies.add(proxy);
    const baseUrl = await proxy.getBaseUrl({
      platformId: 'zenmux',
      endpoint: `http://127.0.0.1:${upstreamAddress.port}/api/v1/`,
      apiKey: 'maas-secret',
    });
    const response = await fetch(`${baseUrl}/responses?stream=true`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer native-chatgpt-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test-model' }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('response.completed');
    expect(received).toEqual({
      authorization: 'Bearer maas-secret',
      path: '/api/v1/responses?stream=true',
      body: '{"model":"test-model"}',
    });
    expect(baseUrl).not.toContain('maas-secret');
  });

  it('reuses one opaque loopback route for identical credentials', async () => {
    const proxy = new CodexMaasProxy();
    openProxies.add(proxy);
    const credentials = {
      platformId: 'zenmux' as const,
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    };

    await expect(proxy.getBaseUrl(credentials)).resolves.toBe(await proxy.getBaseUrl(credentials));
  });
});

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
