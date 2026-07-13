import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeaders, securityHeaders } from './headers.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  allowedOrigins: readonly string[],
  headers: Record<string, string> = {}
): void {
  if (res.destroyed || res.writableEnded) return;
  const serialized = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    ...corsHeaders(req, allowedOrigins),
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(serialized),
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(serialized);
}

export function writeApiError(
  req: IncomingMessage,
  res: ServerResponse,
  error: HttpError,
  allowedOrigins: readonly string[]
): void {
  writeJson(
    req,
    res,
    error.status,
    { error: { code: error.code, message: error.message } },
    allowedOrigins
  );
}

export function readBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new HttpError(408, 'request_timeout', 'Request body timed out.'));
      req.destroy();
    }, timeoutMs);
    timer.unref?.();

    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks, bytes));
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        finish(new HttpError(413, 'body_too_large', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new HttpError(400, 'request_aborted', 'Request was aborted.'));

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

export async function readJsonObject(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const body = await readBody(req, maxBytes, timeoutMs);
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be an object.');
  }
  return value as Record<string, unknown>;
}
