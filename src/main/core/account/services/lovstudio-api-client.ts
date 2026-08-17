import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { YodaApiErrorPayload } from '@shared/yoda-account';
import { ACCOUNT_CONFIG } from '../config';
import { yodaAccountService } from './yoda-account-service';

const gzipAsync = promisify(gzip);

/**
 * Above this size a session-share body is gzipped for transport. Chosen well below
 * Vercel's ~4.5 MB function body ceiling so every body that could plausibly hit it is
 * compressed, while ordinary small shares keep going out as plain JSON.
 */
const GZIP_UPLOAD_THRESHOLD_BYTES = 1024 * 1024;

export class LovStudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: YodaApiErrorPayload['error']
  ) {
    // Electron strips custom properties off an Error rejected across IPC, so status and
    // code have to ride inside the message to be diagnosable from the renderer.
    super(`${message} (${status} ${code})`);
  }
}

export interface LovStudioApiRequestOptions {
  allowDuringSignOut?: boolean;
  expectedUserId?: string;
  expectedGeneration?: number;
  timeoutMs?: number;
}

export class LovStudioApiClient {
  async request<T>(
    path: string,
    init: RequestInit = {},
    options: LovStudioApiRequestOptions = {}
  ): Promise<T> {
    let session = await yodaAccountService.getRequestSession(options);
    let response = await this.fetch(
      path,
      session.accessToken,
      init,
      session.signal,
      options.timeoutMs
    );
    if (response.status === 401 && !options.allowDuringSignOut) {
      session = await yodaAccountService.refreshRequestSession(session);
      response = await this.fetch(
        path,
        session.accessToken,
        init,
        session.signal,
        options.timeoutMs
      );
    }
    if (!options.allowDuringSignOut && !yodaAccountService.isRequestSessionCurrent(session)) {
      throw new Error('LovStudio account changed while the request was in progress');
    }
    if (!response.ok) {
      let payload: YodaApiErrorPayload | null = null;
      try {
        payload = (await response.json()) as YodaApiErrorPayload;
      } catch {
        // The HTTP status remains actionable when an upstream proxy returns non-JSON.
      }
      throw new LovStudioApiError(
        response.status,
        payload?.error.code ?? 'request_failed',
        payload?.error.message ?? 'LovStudio request failed',
        payload?.error
      );
    }
    return (await response.json()) as T;
  }

  private async fetch(
    path: string,
    token: string,
    init: RequestInit,
    accountSignal: AbortSignal,
    timeoutMs = 15_000
  ): Promise<Response> {
    const signals = [accountSignal, AbortSignal.timeout(timeoutMs)];
    if (init.signal) signals.push(init.signal);

    // Compress oversized session-share uploads — the server gunzips before parsing.
    // Vercel measures the *wire* body against its ~4.5 MB function limit, which no
    // server-side limit can raise, so gzip is the only way a very long session fits.
    // Threshold-gated rather than always-on so ordinary shares keep going out as plain
    // JSON: that keeps the blast radius of the encoding on the few bodies that need it.
    // Deploy ordering matters — the server must understand `content-encoding: gzip`
    // before a client that sends it, otherwise such a body reads as invalid JSON.
    // Content-Type still describes the *decoded* payload, so it stays alongside.
    const shouldGzip =
      path === '/api/yoda/session-shares' &&
      init.method === 'POST' &&
      typeof init.body === 'string' &&
      Buffer.byteLength(init.body, 'utf8') > GZIP_UPLOAD_THRESHOLD_BYTES;
    // Async gzip: a multi-MB compress must not block the Electron main process.
    const body = shouldGzip ? await gzipAsync(Buffer.from(init.body as string, 'utf8')) : init.body;

    return fetch(`${ACCOUNT_CONFIG.authServer.baseUrl}${path}`, {
      ...init,
      body,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(shouldGzip ? { 'Content-Encoding': 'gzip' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.any(signals),
    });
  }
}

export const lovStudioApiClient = new LovStudioApiClient();
