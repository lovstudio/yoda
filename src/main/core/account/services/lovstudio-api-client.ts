import { gzipSync } from 'node:zlib';
import type { YodaApiErrorPayload } from '@shared/yoda-account';
import { ACCOUNT_CONFIG } from '../config';
import { yodaAccountService } from './yoda-account-service';

export class LovStudioApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: YodaApiErrorPayload['error']
  ) {
    super(message);
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
        payload?.error.message ?? `LovStudio request failed (${response.status})`,
        payload?.error
      );
    }
    return (await response.json()) as T;
  }

  private fetch(
    path: string,
    token: string,
    init: RequestInit,
    accountSignal: AbortSignal,
    timeoutMs = 15_000
  ): Promise<Response> {
    const signals = [accountSignal, AbortSignal.timeout(timeoutMs)];
    if (init.signal) signals.push(init.signal);

    let body = init.body;
    let headers: HeadersInit;

    // Compress large session-share uploads — the server gunzips before parsing.
    // Vercel serverless functions measure the wire body against their 4.5 MB limit,
    // so gzip bypasses the platform ceiling while staying within the app's semantic limit.
    if (path === '/api/yoda/session-shares' && init.method === 'POST' && typeof body === 'string') {
      const compressed = gzipSync(Buffer.from(body, 'utf8'));
      body = compressed;
      headers = {
        Authorization: `Bearer ${token}`,
        'Content-Encoding': 'gzip',
        ...init.headers,
      };
    } else {
      headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      };
    }

    return fetch(`${ACCOUNT_CONFIG.authServer.baseUrl}${path}`, {
      ...init,
      body,
      headers,
      signal: AbortSignal.any(signals),
    });
  }
}

export const lovStudioApiClient = new LovStudioApiClient();
