import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Session } from 'electron';

export type SparkleFeedProxy = {
  feedUrl: string;
  close: () => Promise<void>;
};

export function rewriteSparkleEnclosureUrls(
  appcast: string,
  localOrigin: string,
  allowedDeltaUrl: string
): { appcast: string; artifacts: ReadonlyMap<string, string> } {
  const artifacts = new Map<string, string>();
  const rewritten = appcast.replace(
    /(<enclosure\b[^>]*?\burl\s*=\s*)(["'])(.*?)\2/gi,
    (_match, prefix: string, quote: string, encodedUrl: string) => {
      const upstream = decodeXmlAttribute(encodedUrl);
      const parsed = new URL(upstream);
      if (parsed.protocol !== 'https:') {
        throw new Error(`Sparkle enclosure must use HTTPS: ${parsed.protocol}`);
      }
      if (upstream !== allowedDeltaUrl) {
        return `${prefix}${quote}${localOrigin}/full-update-disabled${quote}`;
      }
      const token = createHash('sha256').update(upstream).digest('hex');
      artifacts.set(token, upstream);
      return `${prefix}${quote}${localOrigin}/artifact/${token}${quote}`;
    }
  );
  return { appcast: rewritten, artifacts };
}

export async function startSparkleFeedProxy(
  sourceAppcast: string,
  allowedDeltaUrl: string,
  updateSession: Session
): Promise<SparkleFeedProxy> {
  let localAppcast = '';
  let artifacts: ReadonlyMap<string, string> = new Map();

  const server = createServer((request, response) => {
    void handleRequest(request.url ?? '/', request.method ?? 'GET', request.headers, response, {
      appcast: localAppcast,
      artifacts,
      updateSession,
    });
  });

  await listenOnLoopback(server);
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  let rewritten: ReturnType<typeof rewriteSparkleEnclosureUrls>;
  try {
    rewritten = rewriteSparkleEnclosureUrls(sourceAppcast, origin, allowedDeltaUrl);
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  localAppcast = rewritten.appcast;
  artifacts = rewritten.artifacts;

  return {
    feedUrl: `${origin}/appcast.xml`,
    close: () => closeServer(server),
  };
}

type ProxyRequestContext = {
  appcast: string;
  artifacts: ReadonlyMap<string, string>;
  updateSession: Session;
};

async function handleRequest(
  requestUrl: string,
  method: string,
  requestHeaders: NodeJS.Dict<string | string[]>,
  response: ServerResponse,
  context: ProxyRequestContext
): Promise<void> {
  try {
    if (requestUrl === '/appcast.xml') {
      if (method !== 'GET' && method !== 'HEAD') return sendStatus(response, 405);
      const body = Buffer.from(context.appcast, 'utf8');
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
        'Content-Type': 'application/rss+xml; charset=utf-8',
      });
      response.end(method === 'HEAD' ? undefined : body);
      return;
    }

    const artifactMatch = /^\/artifact\/([a-f0-9]{64})$/.exec(requestUrl);
    if (!artifactMatch) return sendStatus(response, 404);
    if (method !== 'GET' && method !== 'HEAD') return sendStatus(response, 405);

    const upstreamUrl = context.artifacts.get(artifactMatch[1]);
    if (!upstreamUrl) return sendStatus(response, 404);

    const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
    copyRequestHeader(requestHeaders, headers, 'range');
    copyRequestHeader(requestHeaders, headers, 'if-range');
    copyRequestHeader(requestHeaders, headers, 'user-agent');

    const upstream = await context.updateSession.fetch(upstreamUrl, { method, headers });
    response.statusCode = upstream.status;
    for (const header of [
      'accept-ranges',
      'content-length',
      'content-range',
      'content-type',
      'etag',
      'last-modified',
    ]) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }

    if (method === 'HEAD' || !upstream.body) {
      response.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!response.write(Buffer.from(result.value))) {
        await new Promise<void>((resolve) => response.once('drain', resolve));
      }
    }
    response.end();
  } catch (error) {
    if (!response.headersSent) response.statusCode = 502;
    response.end(error instanceof Error ? error.message : 'Sparkle proxy request failed');
  }
}

function copyRequestHeader(
  source: NodeJS.Dict<string | string[]>,
  destination: Record<string, string>,
  name: string
): void {
  const value = source[name];
  if (typeof value === 'string') destination[name] = value;
}

function sendStatus(response: ServerResponse, statusCode: number): void {
  response.statusCode = statusCode;
  response.end();
}

async function listenOnLoopback(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
