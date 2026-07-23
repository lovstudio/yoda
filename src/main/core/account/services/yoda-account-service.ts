import {
  accountAuthDeviceCodeChannel,
  accountAuthErrorChannel,
  accountAuthSuccessChannel,
  accountSessionChangedChannel,
} from '@shared/events/accountEvents';
import { KV } from '@main/db/kv';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { ACCOUNT_CONFIG } from '../config';
import { accountCredentialStore, accountRefreshCredentialStore } from './credential-store';

export interface AccountUser {
  userId: string;
  username: string;
  nickname: string;
  nicknameOverride: string;
  name: string;
  avatarUrl: string;
  email: string;
}

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  username: string;
  nickname?: string;
  nicknameOverride?: string;
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

export interface AccountRequestSession {
  userId: string;
  accessToken: string;
  generation: number;
  signal: AbortSignal;
}

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
  refreshToken: string;
  signedOut: boolean;
}

type AccountServiceHooks = {
  accountChanged: (username: string, userId: string, email: string) => void | Promise<void>;
  accountWillClear: () => void | Promise<void>;
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

class SessionRefreshRejectedError extends Error {}

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
  const rawName = hasName ? toTrimmedString(input.name) : toTrimmedString(fallback?.name);

  return {
    nickname,
    name: rawName,
  };
}

function accountUserFromProfile(profile: CachedProfile): AccountUser {
  const names = normalizeAccountNames(profile);
  const nicknameOverride = toTrimmedString(profile.nicknameOverride);
  return {
    userId: profile.userId,
    username: profile.username,
    nickname: names.nickname,
    nicknameOverride,
    name: nicknameOverride || names.nickname || names.name,
    avatarUrl: profile.avatarUrl,
    email: profile.email,
  };
}

function accessTokenSubject(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof decoded.sub === 'string' && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
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
  private sessionGeneration = 0;
  private sessionAbort = new AbortController();
  private refreshAbort: AbortController | null = null;
  private refreshOperation: { generation: number; promise: Promise<boolean> } | null = null;
  private credentialMutationQueue: Promise<void> = Promise.resolve();
  private sessionLoaded = false;
  private loadOperation: Promise<void> | null = null;
  private signingOut = false;
  private signedOut = false;
  private signInOperation: Promise<SignInResult> | null = null;
  private signOutOperation: Promise<void> | null = null;

  on<K extends keyof AccountServiceHooks>(name: K, handler: AccountServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async getSession(): Promise<SessionState> {
    await this.loadSessionToken();
    for (;;) {
      const generation = this.sessionGeneration;
      const profile = await accountKV.get('profile');
      if (generation !== this.sessionGeneration) continue;
      const token = this.sessionToken;
      const hasAccount = profile?.hasAccount === true;
      const tokenMatchesProfile =
        !!token && !!profile && accessTokenSubject(token) === profile.userId;
      const isSignedIn = !this.signingOut && !this.signedOut && hasAccount && tokenMatchesProfile;
      this.cachedProfile = profile;
      return {
        user: isSignedIn && profile ? accountUserFromProfile(profile) : null,
        isSignedIn,
        hasAccount,
      };
    }
  }

  async refreshSession(): Promise<SessionState> {
    await this.validateSession({ forceRefresh: true });
    return this.getSession();
  }

  async updateNickname(nickname: string): Promise<SessionState> {
    const requestSession = await this.getRequestSession();
    await this.mutateCredentials(async () => {
      if (!this.isRequestSessionCurrent(requestSession)) {
        throw new Error('LovStudio account session changed');
      }
      const profile = this.cachedProfile ?? (await accountKV.get('profile'));
      if (!profile?.hasAccount || profile.userId !== requestSession.userId) {
        throw new Error('LovStudio account session changed');
      }

      const updated: CachedProfile = { ...profile };
      const trimmed = nickname.trim();
      if (trimmed) {
        updated.nicknameOverride = trimmed;
      } else {
        delete updated.nicknameOverride;
      }

      await accountKV.setStrict('profile', updated);
      if (!this.isRequestSessionCurrent(requestSession)) {
        throw new Error('LovStudio account session changed');
      }
      this.cachedProfile = updated;
    });
    return this.getSession();
  }

  getSessionToken(): string | null {
    return !this.sessionLoaded || this.signingOut || this.signedOut ? null : this.sessionToken;
  }

  loadSessionToken(): Promise<void> {
    if (this.sessionLoaded) return Promise.resolve();
    if (this.loadOperation) return this.loadOperation;
    const generation = this.sessionGeneration;
    const operation = this.loadSessionTokenInternal(generation)
      .then(() => {
        this.sessionLoaded = true;
      })
      .finally(() => {
        if (this.loadOperation === operation) this.loadOperation = null;
      });
    this.loadOperation = operation;
    return operation;
  }

  private async loadSessionTokenInternal(generation: number): Promise<void> {
    const [storedToken, profile, signedOut] = await Promise.all([
      accountCredentialStore.get(),
      accountKV.get('profile'),
      accountKV.get('signedOut'),
    ]);
    const tokenMatchesProfile =
      !storedToken || (!!profile && accessTokenSubject(storedToken) === profile.userId);
    const shouldStaySignedOut = signedOut || !tokenMatchesProfile;
    let committed = false;
    await this.mutateCredentials(async () => {
      if (generation !== this.sessionGeneration || this.signingOut) return;
      this.signedOut = Boolean(shouldStaySignedOut);
      this.cachedProfile = profile;
      this.sessionToken = shouldStaySignedOut ? null : storedToken;
      this.rotateSessionGeneration();
      if (shouldStaySignedOut) {
        await this.clearCredentialsForSignedOutState('session initialization');
      }
      const legacyRefreshToken = await accountKV.get('refreshToken');
      if (legacyRefreshToken && !shouldStaySignedOut) {
        if (!(await accountRefreshCredentialStore.get())) {
          await accountRefreshCredentialStore.set(legacyRefreshToken);
        }
        await accountKV.delStrict('refreshToken');
      } else if (legacyRefreshToken) {
        await accountKV.delStrict('refreshToken');
      }
      committed = true;
    });
    if (committed && this.sessionToken && this.cachedProfile?.hasAccount) {
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
    if (!this.sessionLoaded) {
      void this.loadSessionToken().then(() => this.warmUp());
      return;
    }
    if (this.sessionToken || this.signingOut) return;
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

  signIn(provider?: string): Promise<SignInResult> {
    if (this.signingOut) return Promise.reject(new Error('Sign-out is still in progress'));
    if (this.signInOperation) return this.signInOperation;
    this.signInOperation = this.loadSessionToken()
      .then(() => this.signInInternal(provider))
      .finally(() => {
        this.signInOperation = null;
      });
    return this.signInOperation;
  }

  private async signInInternal(_provider?: string): Promise<SignInResult> {
    if (this.sessionToken) throw new Error('Sign out before switching LovStudio accounts');
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
      const nicknameOverride =
        this.cachedProfile?.userId === session.user.id
          ? this.cachedProfile.nicknameOverride
          : undefined;
      const profile: CachedProfile = {
        hasAccount: true,
        userId: session.user.id,
        username,
        nickname: names.nickname,
        nicknameOverride,
        name: names.name,
        avatarUrl: session.user.avatarUrl?.trim() ?? '',
        email: session.user.email,
        lastValidated: new Date().toISOString(),
      };
      if (accessTokenSubject(session.accessToken) !== session.user.id) {
        throw new Error('LovStudio sign-in returned an invalid account token');
      }

      if (this.signingOut || cancelSignal.signal.aborted) throw new Error('Sign-in was cancelled');
      const sessionGeneration = this.rotateSessionGeneration();
      await this.mutateCredentials(async () => {
        if (this.signingOut || sessionGeneration !== this.sessionGeneration) {
          throw new Error('Sign-in was cancelled');
        }
        await accountCredentialStore.set(session.accessToken);
        await accountRefreshCredentialStore.set(session.refreshToken);
        await accountKV.setStrict('profile', profile);
        await accountKV.delStrict('signedOut');
        if (this.signingOut || sessionGeneration !== this.sessionGeneration) {
          throw new Error('Sign-in was cancelled');
        }
        this.sessionToken = session.accessToken;
        this.cachedProfile = profile;
        this.signedOut = false;
      });

      const user = accountUserFromProfile(profile);

      events.emit(accountAuthSuccessChannel, { user });
      events.emit(accountSessionChangedChannel, undefined);
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

  signOut(): Promise<void> {
    if (this.signOutOperation) return this.signOutOperation;
    this.signOutOperation = this.loadSessionToken()
      .then(() => this.signOutInternal())
      .finally(() => {
        this.signOutOperation = null;
      });
    return this.signOutOperation;
  }

  private async signOutInternal(): Promise<void> {
    this.signingOut = true;
    this.signedOut = true;
    this.cancelSignIn();
    this.rotateSessionGeneration();
    try {
      await this._hooks.callHook('accountWillClear');
      await this.revokeServerSession();
    } finally {
      try {
        await this.mutateCredentials(async () => {
          await this.clearCredentialsForSignedOutState('sign-out');
          if (this.cachedProfile) {
            this.cachedProfile.hasAccount = true;
            await accountKV.setStrict('profile', this.cachedProfile);
          }
        });
      } finally {
        this.rotateSessionGeneration();
        this.signingOut = false;
        events.emit(accountSessionChangedChannel, undefined);
        this._hooks.callHookBackground('accountCleared');
      }
    }
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

  private async revokeServerSession(): Promise<void> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const accessToken = this.sessionToken;
    let refreshToken: string | null = null;
    try {
      refreshToken = await accountRefreshCredentialStore.get();
    } catch (error) {
      log.warn('Failed to read the LovStudio refresh credential during sign-out', error);
    }
    if (!accessToken && !refreshToken) return;
    try {
      const response = await fetch(`${baseUrl}/api/cli/auth/signout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ refreshToken }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) log.warn(`LovStudio session sign-out failed (${response.status})`);
    } catch (error) {
      // Local sign-out must always complete even if LovStudio is temporarily unreachable.
      log.warn('LovStudio session sign-out request failed', error);
    }
  }

  async validateSession(
    options: { forceRefresh?: boolean; expectedGeneration?: number } = {}
  ): Promise<boolean> {
    await this.loadSessionToken();
    if (this.signingOut || this.signedOut) return false;
    if (
      options.expectedGeneration !== undefined &&
      options.expectedGeneration !== this.sessionGeneration
    ) {
      return false;
    }
    if (this.sessionToken && !options.forceRefresh) return true;
    if (this.refreshOperation?.generation === this.sessionGeneration) {
      return this.refreshOperation.promise;
    }
    const generation = this.sessionGeneration;
    const promise = this.validateSessionInternal(generation).finally(() => {
      if (this.refreshOperation?.generation === generation) this.refreshOperation = null;
    });
    this.refreshOperation = { generation, promise };
    return promise;
  }

  private async validateSessionInternal(generation: number): Promise<boolean> {
    const refreshToken =
      (await accountRefreshCredentialStore.get()) ?? (await accountKV.get('refreshToken'));
    if (!refreshToken || this.signingOut || this.signedOut) return false;
    if (generation !== this.sessionGeneration) return false;
    const controller = new AbortController();
    this.refreshAbort = controller;
    try {
      await this.refreshAccessToken(refreshToken, generation, controller.signal);
      return true;
    } catch (err) {
      if (generation !== this.sessionGeneration || this.signingOut || this.signedOut) return false;
      if (!(err instanceof SessionRefreshRejectedError)) {
        // Offline, timeout, and server errors must not turn a temporary connectivity
        // problem into a permanent sign-out. Keep both credentials so the next
        // authenticated request can retry the refresh automatically.
        log.warn('Session refresh failed; keeping local credentials for retry', err);
        return false;
      }
      log.warn('Session refresh was rejected; clearing local credentials', err);
      this.signedOut = true;
      try {
        await this.mutateCredentials(async () => {
          if (generation !== this.sessionGeneration || this.signingOut) return;
          await this.clearCredentialsForSignedOutState('expired session');
        });
      } finally {
        events.emit(accountSessionChangedChannel, undefined);
        this._hooks.callHookBackground('accountCleared');
      }
      return false;
    } finally {
      if (this.refreshAbort === controller) this.refreshAbort = null;
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

  private async refreshAccessToken(
    refreshToken: string,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const response = await fetch(`${baseUrl}/api/cli/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new SessionRefreshRejectedError('Refresh credential was rejected');
      }
      throw new Error(`Refresh failed (${response.status})`);
    }
    const json = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
      user?: AccountProfilePayload;
    };
    const profile = this.cachedProfile ?? (await accountKV.get('profile'));
    if (!profile?.hasAccount) throw new Error('LovStudio account profile is unavailable');
    if (accessTokenSubject(json.accessToken) !== profile.userId) {
      throw new Error('LovStudio refresh returned an invalid account token');
    }
    if (json.user?.id && json.user.id !== profile.userId) {
      throw new Error('LovStudio refresh returned a different account');
    }
    const updatedProfile = json.user
      ? (() => {
          const names = normalizeAccountNames(json.user, profile);
          return {
            ...profile,
            nickname: names.nickname,
            name: names.name,
            avatarUrl: json.user.avatarUrl?.trim() || profile.avatarUrl || '',
            email: json.user.email || profile.email,
            lastValidated: new Date().toISOString(),
          } satisfies CachedProfile;
        })()
      : profile;

    await this.mutateCredentials(async () => {
      if (generation !== this.sessionGeneration || this.signingOut || this.signedOut) {
        throw new Error('Session refresh was cancelled');
      }
      await accountCredentialStore.set(json.accessToken);
      await accountRefreshCredentialStore.set(json.refreshToken);
      await accountKV.delStrict('refreshToken');
      await accountKV.setStrict('profile', updatedProfile);
      if (generation !== this.sessionGeneration || this.signingOut || this.signedOut) {
        throw new Error('Session refresh was cancelled');
      }
      this.sessionToken = json.accessToken;
      this.cachedProfile = updatedProfile;
    });
  }

  async getRequestSession(
    options: {
      allowDuringSignOut?: boolean;
      expectedUserId?: string;
      expectedGeneration?: number;
    } = {}
  ): Promise<AccountRequestSession> {
    await this.loadSessionToken();
    const allowedSignOutRequest = options.allowDuringSignOut && this.signingOut;
    if ((this.signingOut || this.signedOut) && !allowedSignOutRequest) {
      throw new Error(
        this.signingOut
          ? 'LovStudio account is signing out'
          : 'LovStudio account session is unavailable'
      );
    }
    const generation = this.sessionGeneration;
    if (options.expectedGeneration !== undefined && options.expectedGeneration !== generation) {
      throw new Error('LovStudio account session changed');
    }
    if (!this.sessionToken) {
      if (allowedSignOutRequest) {
        throw new Error('LovStudio account session is unavailable');
      }
      const valid = await this.validateSession({ expectedGeneration: generation });
      if (!valid) throw new Error('LovStudio account session is unavailable');
    }
    const profile = this.cachedProfile ?? (await accountKV.get('profile'));
    if (
      generation !== this.sessionGeneration ||
      ((this.signingOut || this.signedOut) && !allowedSignOutRequest) ||
      !this.sessionToken ||
      !profile?.hasAccount ||
      accessTokenSubject(this.sessionToken) !== profile.userId ||
      (options.expectedUserId !== undefined && options.expectedUserId !== profile.userId)
    ) {
      throw new Error('LovStudio account session changed');
    }
    this.cachedProfile = profile;
    return {
      userId: profile.userId,
      accessToken: this.sessionToken,
      generation,
      signal: this.sessionAbort.signal,
    };
  }

  async refreshRequestSession(expected: AccountRequestSession): Promise<AccountRequestSession> {
    if (!this.isRequestSessionCurrent(expected) || this.signingOut || this.signedOut) {
      throw new Error('LovStudio account session changed');
    }
    const valid = await this.validateSession({
      forceRefresh: true,
      expectedGeneration: expected.generation,
    });
    if (!valid || !this.isRequestSessionCurrent(expected)) {
      throw new Error('LovStudio account session changed');
    }
    const refreshed = await this.getRequestSession();
    if (refreshed.userId !== expected.userId || refreshed.generation !== expected.generation) {
      throw new Error('LovStudio account session changed');
    }
    return refreshed;
  }

  isRequestSessionCurrent(session: AccountRequestSession): boolean {
    return (
      !this.signingOut &&
      !this.signedOut &&
      session.generation === this.sessionGeneration &&
      session.userId === this.cachedProfile?.userId &&
      accessTokenSubject(session.accessToken) === session.userId &&
      !session.signal.aborted
    );
  }

  async getValidSessionToken(forceRefresh = false): Promise<string> {
    await this.loadSessionToken();
    if (this.signingOut || this.signedOut) {
      throw new Error('LovStudio account session is unavailable');
    }
    if (forceRefresh || !this.sessionToken) {
      const valid = await this.validateSession({ forceRefresh: true });
      if (!valid || !this.sessionToken) throw new Error('LovStudio account session is unavailable');
    }
    const profile = this.cachedProfile ?? (await accountKV.get('profile'));
    if (!profile || accessTokenSubject(this.sessionToken) !== profile.userId) {
      throw new Error('LovStudio account session changed');
    }
    return this.sessionToken;
  }

  private rotateSessionGeneration(): number {
    this.sessionAbort.abort();
    this.refreshAbort?.abort();
    this.sessionGeneration += 1;
    this.sessionAbort = new AbortController();
    return this.sessionGeneration;
  }

  private mutateCredentials<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.credentialMutationQueue.then(mutation, mutation);
    this.credentialMutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async clearCredentialsForSignedOutState(context: string): Promise<void> {
    this.signedOut = true;
    this.sessionToken = null;
    const results = await Promise.allSettled([
      accountKV.setStrict('signedOut', true),
      accountCredentialStore.clear(),
      accountRefreshCredentialStore.clear(),
      accountKV.delStrict('refreshToken'),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn(`Failed to clear a LovStudio credential during ${context}`, result.reason);
      }
    }
    const tombstoneFailed = results[0]?.status === 'rejected';
    const recoverableCredentialClearFailed = results
      .slice(1)
      .some((result) => result?.status === 'rejected');
    if (tombstoneFailed && recoverableCredentialClearFailed) {
      throw new Error('Failed to persist LovStudio sign-out state');
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
