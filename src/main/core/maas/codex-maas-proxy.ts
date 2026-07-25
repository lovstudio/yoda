import { createHash, randomBytes } from 'node:crypto';
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import https from 'node:https';
import type { MaasRuntimeCredentials } from './runtime-env';

type Route = {
  upstreamBaseUrl: URL;
  apiKey: string;
};

const LOOPBACK_HOST = '127.0.0.1';
const ROUTE_API_PREFIX = 'v1';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Keeps Codex on its native ChatGPT login while routing only Yoda-launched
 * requests through MaaS. The upstream API key never enters Codex's process,
 * so Codex cannot persist it into ~/.codex/auth.json.
 */
export class CodexMaasProxy {
  private server: http.Server | undefined;
  private starting: Promise<void> | undefined;
  private readonly routesByToken = new Map<string, Route>();
  private readonly baseUrlByFingerprint = new Map<string, string>();

  async getBaseUrl(credentials: MaasRuntimeCredentials): Promise<string> {
    const upstreamBaseUrl = parseUpstreamBaseUrl(credentials.endpoint);
    await this.ensureStarted();

    const fingerprint = createHash('sha256')
      .update(upstreamBaseUrl.toString())
      .update('\0')
      .update(credentials.apiKey)
      .digest('hex');
    const existing = this.baseUrlByFingerprint.get(fingerprint);
    if (existing) return existing;

    const token = randomBytes(24).toString('hex');
    const address = this.server?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Codex MaaS proxy did not expose a loopback port.');
    }

    this.routesByToken.set(token, { upstreamBaseUrl, apiKey: credentials.apiKey });
    const baseUrl = `http://${LOOPBACK_HOST}:${address.port}/${token}/${ROUTE_API_PREFIX}`;
    this.baseUrlByFingerprint.set(fingerprint, baseUrl);
    return baseUrl;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.starting = undefined;
    this.routesByToken.clear();
    this.baseUrlByFingerprint.clear();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async ensureStarted(): Promise<void> {
    if (this.server?.listening) return;
    if (this.starting) return this.starting;

    const server = http.createServer((request, response) => this.forward(request, response));
    server.on('clientError', (_error, socket) => {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    this.server = server;
    this.starting = new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = undefined;
        this.starting = undefined;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        server.unref();
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, LOOPBACK_HOST);
    });
    return this.starting;
  }

  private forward(request: IncomingMessage, response: ServerResponse): void {
    const match = request.url?.match(/^\/([a-f0-9]{48})\/v1(?=\/|\?|$)/);
    const route = match ? this.routesByToken.get(match[1]) : undefined;
    if (!match || !route) {
      writeJsonError(response, 404, 'Unknown Codex MaaS route.');
      return;
    }

    const requestUrl = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
    const routePrefix = `/${match[1]}/${ROUTE_API_PREFIX}`;
    const suffix = requestUrl.pathname.slice(routePrefix.length);
    const target = new URL(route.upstreamBaseUrl);
    target.pathname = `${trimTrailingSlash(target.pathname)}${suffix}`;
    target.search = requestUrl.search;

    const headers = sanitizeHeaders(request.headers);
    headers.authorization = `Bearer ${route.apiKey}`;
    headers.host = target.host;

    const transport = target.protocol === 'https:' ? https : http;
    const upstreamRequest = transport.request(
      target,
      {
        method: request.method,
        headers,
      },
      (upstreamResponse) => {
        const responseHeaders = sanitizeHeaders(upstreamResponse.headers);
        response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(response);
      }
    );
    upstreamRequest.on('error', (error) => {
      if (!response.headersSent) {
        writeJsonError(response, 502, `MaaS upstream request failed: ${error.message}`);
      } else {
        response.destroy(error);
      }
    });
    request.on('aborted', () => upstreamRequest.destroy());
    request.pipe(upstreamRequest);
  }
}

function parseUpstreamBaseUrl(endpoint: string): URL {
  const parsed = new URL(trimTrailingSlash(endpoint));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Codex MaaS proxy only supports HTTP(S) endpoints.');
  }
  return parsed;
}

function sanitizeHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => {
      return value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase());
    })
  );
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function writeJsonError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message } }));
}

export const codexMaasProxy = new CodexMaasProxy();
