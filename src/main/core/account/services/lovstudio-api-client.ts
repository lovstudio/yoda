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
}

export class LovStudioApiClient {
  async request<T>(
    path: string,
    init: RequestInit = {},
    options: LovStudioApiRequestOptions = {}
  ): Promise<T> {
    let session = await yodaAccountService.getRequestSession(options);
    let response = await this.fetch(path, session.accessToken, init, session.signal);
    if (response.status === 401 && !options.allowDuringSignOut) {
      session = await yodaAccountService.refreshRequestSession(session);
      response = await this.fetch(path, session.accessToken, init, session.signal);
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
    accountSignal: AbortSignal
  ): Promise<Response> {
    const signals = [accountSignal, AbortSignal.timeout(15_000)];
    if (init.signal) signals.push(init.signal);
    return fetch(`${ACCOUNT_CONFIG.authServer.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.any(signals),
    });
  }
}

export const lovStudioApiClient = new LovStudioApiClient();
