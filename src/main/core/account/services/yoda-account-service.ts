import {
  accountAuthDeviceCodeChannel,
  accountAuthErrorChannel,
  accountAuthSuccessChannel,
} from '@shared/events/accountEvents';
import { KV } from '@main/db/kv';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { ACCOUNT_CONFIG } from '../config';
import { accountCredentialStore } from './credential-store';

export interface AccountUser {
  userId: string;
  username: string;
  nickname: string;
  name: string;
  avatarUrl: string;
  email: string;
}

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  username: string;
  nickname?: string;
  name: string;
  avatarUrl: string;
  email: string;
  lastValidated: string;
}

export interface SignInResult {
  user: AccountUser;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
  refreshToken: string;
}

type AccountServiceHooks = {
  accountChanged: (username: string, userId: string, email: string) => void | Promise<void>;
  accountCleared: () => void | Promise<void>;
};

interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

interface DevicePollSuccessResponse {
  status: 'authenticated';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
  user: AccountProfilePayload;
}

interface DevicePollPendingResponse {
  status?: 'pending';
  error: string;
}

const accountKV = new KV<AccountKVSchema>('account');

function deriveUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'user';
  return local.replace(/[^a-zA-Z0-9_-]/g, '');
}

type AccountProfilePayload = {
  id: string;
  email: string;
  nickname?: string;
  name?: string;
  avatarUrl?: string;
};

function hasOwnKey<T extends object, K extends PropertyKey>(
  value: T,
  key: K
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAccountNames(
  input: { nickname?: unknown; name?: unknown },
  fallback?: Pick<CachedProfile, 'nickname' | 'name'>
): { nickname: string; name: string } {
  const hasNickname = hasOwnKey(input, 'nickname');
  const hasName = hasOwnKey(input, 'name');
  const nickname = hasNickname
    ? toTrimmedString(input.nickname)
    : toTrimmedString(fallback?.nickname);
  const rawName = hasName
    ? toTrimmedString(input.name)
    : hasNickname
      ? ''
      : toTrimmedString(fallback?.name);

  return {
    nickname,
    name: nickname || rawName,
  };
}

function accountUserFromProfile(profile: CachedProfile): AccountUser {
  const names = normalizeAccountNames(profile);
  return {
    userId: profile.userId,
    username: profile.username,
    nickname: names.nickname,
    name: names.name,
    avatarUrl: profile.avatarUrl,
    email: profile.email,
  };
}

export class YodaAccountService implements Hookable<AccountServiceHooks> {
  private readonly _hooks = new HookCore<AccountServiceHooks>((name, e) =>
    log.error(`YodaAccountService: ${String(name)} hook error`, e)
  );
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;
  private cancelSignal: AbortController | null = null;
  private lastWarmUpAttemptAt = 0;
  private prefetchedStart: { start: DeviceStartResponse; fetchedAt: number } | null = null;
  private prefetchInFlight: Promise<void> | null = null;

  on<K extends keyof AccountServiceHooks>(name: K, handler: AccountServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async getSession(): Promise<SessionState> {
    this.cachedProfile = await accountKV.get('profile');
    const hasAccount = this.cachedProfile?.hasAccount === true;
    const isSignedIn = hasAccount && this.sessionToken !== null;
    return {
      user: isSignedIn && this.cachedProfile ? accountUserFromProfile(this.cachedProfile) : null,
      isSignedIn,
      hasAccount,
    };
  }

  async refreshSession(): Promise<SessionState> {
    await this.validateSession({ forceRefresh: true });
    return this.getSession();
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  async loadSessionToken(): Promise<void> {
    [this.sessionToken, this.cachedProfile] = await Promise.all([
      accountCredentialStore.get(),
      accountKV.get('profile'),
    ]);
    if (this.sessionToken && this.cachedProfile?.hasAccount) {
      this._hooks.callHookBackground(
        'accountChanged',
        this.cachedProfile.username,
        this.cachedProfile.userId,
        this.cachedProfile.email
      );
    }
  }

  /**
   * Pre-warm a sign-in while the sign-in affordance is merely visible:
   * actually start a device flow and cache the issued code, so a later
   * signIn() can surface it instantly instead of paying the server
   * roundtrip after the click. Unused codes simply expire server-side.
   * Failures are irrelevant by design — signIn() falls back to a live call.
   */
  warmUp(): void {
    if (this.sessionToken) return;
    if (this.getFreshPrefetchedStart() || this.prefetchInFlight) return;
    const now = Date.now();
    if (now - this.lastWarmUpAttemptAt < 30_000) return;
    this.lastWarmUpAttemptAt = now;

    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    this.prefetchInFlight = this.startDeviceFlow(baseUrl, AbortSignal.timeout(15_000))
      .then((start) => {
        this.prefetchedStart = { start, fetchedAt: Date.now() };
      })
      .catch(() => {})
      .finally(() => {
        this.prefetchInFlight = null;
      });
  }

  /**
   * Return the prefetched device-flow start with its TTL adjusted for the
   * time it spent in the cache, or null when it is too stale to hand out.
   * Codes are valid for 10 minutes; require a generous remainder so the
   * user never starts against an about-to-expire code.
   */
  private getFreshPrefetchedStart(): DeviceStartResponse | null {
    if (!this.prefetchedStart) return null;
    const elapsedSec = Math.floor((Date.now() - this.prefetchedStart.fetchedAt) / 1000);
    const remaining = this.prefetchedStart.start.expiresIn - elapsedSec;
    if (remaining < 300) {
      this.prefetchedStart = null;
      return null;
    }
    return { ...this.prefetchedStart.start, expiresIn: remaining };
  }

  async signIn(_provider?: string): Promise<SignInResult> {
    this.cancelSignIn();
    const cancelSignal = new AbortController();
    this.cancelSignal = cancelSignal;

    const { baseUrl, authTimeoutMs } = ACCOUNT_CONFIG.authServer;

    try {
      // A prefetch may be mid-flight from warmUp(); ride it instead of racing it.
      if (this.prefetchInFlight) await this.prefetchInFlight;
      let start = this.getFreshPrefetchedStart();
      if (start) {
        this.prefetchedStart = null; // single use
      } else {
        start = await this.startDeviceFlow(baseUrl, cancelSignal.signal);
      }

      events.emit(accountAuthDeviceCodeChannel, {
        userCode: start.userCode,
        verificationUri: start.verificationUri,
        verificationUriComplete: start.verificationUriComplete,
        expiresIn: start.expiresIn,
        interval: start.interval,
      });

      const session = await this.pollUntilAuthenticated(
        baseUrl,
        start,
        cancelSignal.signal,
        authTimeoutMs
      );

      const username = deriveUsernameFromEmail(session.user.email);
      const names = normalizeAccountNames(session.user);
      const profile: CachedProfile = {
        hasAccount: true,
        userId: session.user.id,
        username,
        nickname: names.nickname,
        name: names.name,
        avatarUrl: session.user.avatarUrl?.trim() ?? '',
        email: session.user.email,
        lastValidated: new Date().toISOString(),
      };

      await accountCredentialStore.set(session.accessToken);
      await accountKV.set('refreshToken', session.refreshToken);
      await accountKV.set('profile', profile);
      this.sessionToken = session.accessToken;
      this.cachedProfile = profile;

      const user = accountUserFromProfile(profile);

      events.emit(accountAuthSuccessChannel, { user });
      this._hooks.callHookBackground('accountChanged', user.username, user.userId, user.email);

      return { user };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      if (!cancelSignal.signal.aborted) {
        events.emit(accountAuthErrorChannel, { message });
      }
      throw err;
    } finally {
      if (this.cancelSignal === cancelSignal) {
        this.cancelSignal = null;
      }
    }
  }

  cancelSignIn(): void {
    if (this.cancelSignal && !this.cancelSignal.signal.aborted) {
      this.cancelSignal.abort();
    }
    this.cancelSignal = null;
  }

  async signOut(): Promise<void> {
    this.cancelSignIn();
    this.sessionToken = null;
    await accountCredentialStore.clear();
    await accountKV.del('refreshToken');
    if (this.cachedProfile) {
      this.cachedProfile.hasAccount = true;
      await accountKV.set('profile', this.cachedProfile);
    }
    this._hooks.callHookBackground('accountCleared');
  }

  async checkServerHealth(): Promise<boolean> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(baseUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      return response.ok || response.status < 500;
    } catch {
      return false;
    }
  }

  async validateSession(options: { forceRefresh?: boolean } = {}): Promise<boolean> {
    if (this.sessionToken && !options.forceRefresh) return true;
    const refreshToken = await accountKV.get('refreshToken');
    if (!refreshToken) return false;
    try {
      await this.refreshAccessToken(refreshToken);
      return true;
    } catch (err) {
      log.warn('Session refresh failed; clearing local credentials', err);
      this.sessionToken = null;
      await accountCredentialStore.clear();
      await accountKV.del('refreshToken');
      this._hooks.callHookBackground('accountCleared');
      return false;
    }
  }

  private async startDeviceFlow(
    baseUrl: string,
    signal: AbortSignal
  ): Promise<DeviceStartResponse> {
    const response = await fetch(`${baseUrl}/api/cli/auth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'Yoda', scope: 'yoda' }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Device flow start failed (${response.status})`);
    }
    const json = (await response.json()) as DeviceStartResponse | { error: string };
    if ('error' in json) {
      throw new Error(`Device flow start failed: ${json.error}`);
    }
    return json;
  }

  private async pollUntilAuthenticated(
    baseUrl: string,
    start: DeviceStartResponse,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<DevicePollSuccessResponse> {
    const deadline = Date.now() + Math.min(timeoutMs, start.expiresIn * 1000);
    let interval = Math.max(start.interval, 1) * 1000;

    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Sign-in cancelled');
      await sleep(interval, signal);
      if (signal.aborted) throw new Error('Sign-in cancelled');

      const response = await fetch(`${baseUrl}/api/cli/auth/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: start.deviceCode }),
        signal,
      });
      if (!response.ok && response.status !== 400) {
        throw new Error(`Poll failed (${response.status})`);
      }
      const json = (await response.json()) as DevicePollSuccessResponse | DevicePollPendingResponse;
      if ('status' in json && json.status === 'authenticated') {
        return json;
      }
      if ('error' in json) {
        if (json.error === 'authorization_pending') continue;
        if (json.error === 'slow_down') {
          interval *= 2;
          continue;
        }
        if (json.error === 'expired_token') {
          throw new Error('Authorization code expired. Please try again.');
        }
        if (json.error === 'access_denied') {
          throw new Error('Authorization was denied.');
        }
        throw new Error(json.error);
      }
    }
    throw new Error('Sign-in timed out. Please try again.');
  }

  private async refreshAccessToken(refreshToken: string): Promise<void> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const response = await fetch(`${baseUrl}/api/cli/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Refresh failed (${response.status})`);
    }
    const json = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
      user?: AccountProfilePayload;
    };
    await accountCredentialStore.set(json.accessToken);
    await accountKV.set('refreshToken', json.refreshToken);
    this.sessionToken = json.accessToken;

    if (json.user && this.cachedProfile) {
      const names = normalizeAccountNames(json.user, this.cachedProfile);
      const updated: CachedProfile = {
        ...this.cachedProfile,
        userId: json.user.id || this.cachedProfile.userId,
        nickname: names.nickname,
        name: names.name,
        avatarUrl: json.user.avatarUrl?.trim() || this.cachedProfile.avatarUrl || '',
        email: json.user.email || this.cachedProfile.email,
        lastValidated: new Date().toISOString(),
      };
      this.cachedProfile = updated;
      await accountKV.set('profile', updated);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export const yodaAccountService = new YodaAccountService();
