import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { MaasGatewayProviderConfiguration } from './protocol';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

const REQUEST_HEADERS_TO_DROP = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-api-key',
  'x-yoda-maas-gateway-token',
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'upgrade',
]);

export type MaasGatewayServer = {
  port: number;
  setConfiguration(configuration: MaasGatewayProviderConfiguration | null): void;
  close(): Promise<void>;
};

export async function createMaasGatewayServer({
  admissionToken,
  port = 0,
  fetchImpl = fetch,
}: {
  admissionToken: string;
  port?: number;
  fetchImpl?: typeof fetch;
}): Promise<MaasGatewayServer> {
  if (!admissionToken.trim()) throw new Error('A MaaS Gateway admission token is required.');

  let configuration: MaasGatewayProviderConfiguration | null = null;
  const server = http.createServer((request, response) => {
    void handleRequest({
      request,
      response,
      admissionToken,
      configuration: () => configuration,
      fetchImpl,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('MaaS Gateway did not expose a TCP port.');
  }

  return {
    port: address.port,
    setConfiguration(next) {
      configuration = next ? { ...next } : null;
    },
    close: () => closeServer(server),
  };
}

async function handleRequest({
  request,
  response,
  admissionToken,
  configuration,
  fetchImpl,
}: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  admissionToken: string;
  configuration: () => MaasGatewayProviderConfiguration | null;
  fetchImpl: typeof fetch;
}): Promise<void> {
  try {
    const activeConfiguration = configuration();
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, {
        ok: true,
        configured: activeConfiguration !== null,
        providerId: activeConfiguration?.providerId ?? null,
      });
      return;
    }

    if (!isAuthorized(request, admissionToken)) {
      writeJson(response, 401, {
        error: { type: 'authentication_error', message: 'MaaS Gateway token required.' },
      });
      return;
    }

    if (!activeConfiguration) {
      writeJson(response, 503, {
        error: { type: 'server_error', message: 'No MaaS provider is active.' },
      });
      return;
    }

    await proxyRequest(request, response, activeConfiguration, fetchImpl);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    writeJson(response, 502, {
      error: {
        type: 'api_error',
        message: error instanceof Error ? error.message : 'MaaS Gateway request failed.',
      },
    });
  }
}

function isAuthorized(request: http.IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  const explicit = headerValue(request.headers['x-yoda-maas-gateway-token']);
  const actual = explicit || authorization || '';
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0]?.trim() ?? '') : (value?.trim() ?? '');
}

async function proxyRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  configuration: MaasGatewayProviderConfiguration,
  fetchImpl: typeof fetch
): Promise<void> {
  const target = resolveUpstreamUrl(configuration.endpoint, request.url ?? '/');
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(request.headers)) {
    if (REQUEST_HEADERS_TO_DROP.has(name.toLowerCase()) || rawValue === undefined) continue;
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      headers.append(name, value);
    }
  }
  headers.set('Authorization', `Bearer ${configuration.apiKey}`);

  const method = request.method ?? 'POST';
  const requestBody =
    method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(request);
  const body = requestBody ? new Uint8Array(requestBody) : undefined;
  const upstream = await fetchImpl(target, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((value, name) => {
    if (!RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())) {
      responseHeaders[name] = value;
    }
  });
  response.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    response.end();
    return;
  }
  for await (const chunk of upstream.body) {
    if (!response.write(Buffer.from(chunk))) {
      await once(response, 'drain');
    }
  }
  response.end();
}

function resolveUpstreamUrl(endpoint: string, requestPath: string): URL {
  const base = new URL(ensureTrailingSlash(endpoint));
  const incoming = new URL(requestPath, 'http://127.0.0.1');
  const basePath = base.pathname.replace(/\/+$/, '');
  const incomingPath =
    basePath.endsWith('/v1') && incoming.pathname.startsWith('/v1/')
      ? incoming.pathname.slice('/v1'.length)
      : incoming.pathname;
  base.pathname = `${basePath}${incomingPath.startsWith('/') ? '' : '/'}${incomingPath}`;
  base.search = incoming.search;
  return base;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

async function readRequestBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error('MaaS Gateway request body exceeds 64 MiB.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function writeJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

export const testing = {
  resolveUpstreamUrl,
};
