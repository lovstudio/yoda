import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountSessionChangedChannel } from '@shared/events/accountEvents';
import { YodaAccountService } from './yoda-account-service';

const mocks = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  profileGetPromise: null as Promise<unknown> | null,
  accessToken: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWEifQ.' as string | null,
  accessGetPromise: null as Promise<string | null> | null,
  refreshToken: 'refresh-a' as string | null,
  accessClearError: null as Error | null,
  refreshClearError: null as Error | null,
  signedOutSetError: null as Error | null,
  legacyRefreshDeleteError: null as Error | null,
  emit: vi.fn(),
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get(key: string) {
      if (key === 'profile' && mocks.profileGetPromise) {
        const pending = mocks.profileGetPromise;
        mocks.profileGetPromise = null;
        return pending;
      }
      return mocks.kv.get(key);
    }
    async set(key: string, value: unknown) {
      if (key === 'signedOut' && mocks.signedOutSetError) throw mocks.signedOutSetError;
      mocks.kv.set(key, value);
    }
    async setStrict(key: string, value: unknown) {
      if (key === 'signedOut' && mocks.signedOutSetError) throw mocks.signedOutSetError;
      mocks.kv.set(key, value);
    }
    async del(key: string) {
      if (key === 'refreshToken' && mocks.legacyRefreshDeleteError) {
        throw mocks.legacyRefreshDeleteError;
      }
      mocks.kv.delete(key);
    }
    async delStrict(key: string) {
      if (key === 'refreshToken' && mocks.legacyRefreshDeleteError) {
        throw mocks.legacyRefreshDeleteError;
      }
      mocks.kv.delete(key);
    }
  },
}));

vi.mock('./credential-store', () => ({
  accountCredentialStore: {
    get: vi.fn(async () =>
      mocks.accessGetPromise ? await mocks.accessGetPromise : mocks.accessToken
    ),
    set: vi.fn(async (value: string) => {
      mocks.accessToken = value;
    }),
    clear: vi.fn(async () => {
      if (mocks.accessClearError) throw mocks.accessClearError;
      mocks.accessToken = null;
    }),
  },
  accountRefreshCredentialStore: {
    get: vi.fn(async () => mocks.refreshToken),
    set: vi.fn(async (value: string) => {
      mocks.refreshToken = value;
    }),
    clear: vi.fn(async () => {
      if (mocks.refreshClearError) throw mocks.refreshClearError;
      mocks.refreshToken = null;
    }),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: mocks.emit },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../config', () => ({
  ACCOUNT_CONFIG: {
    authServer: { baseUrl: 'https://lovstudio.test', authTimeoutMs: 60_000 },
  },
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('YodaAccountService lifecycle', () => {
  beforeEach(() => {
    mocks.kv.clear();
    mocks.kv.set('profile', {
      hasAccount: true,
      userId: 'account-a',
      username: 'account-a',
      name: 'Account A',
      avatarUrl: '',
      email: 'a@example.com',
      lastValidated: '2026-07-12T00:00:00.000Z',
    });
    mocks.accessToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWEifQ.';
    mocks.profileGetPromise = null;
    mocks.accessGetPromise = null;
    mocks.refreshToken = 'refresh-a';
    mocks.accessClearError = null;
    mocks.refreshClearError = null;
    mocks.signedOutSetError = null;
    mocks.legacyRefreshDeleteError = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks refresh and new account requests for the entire sign-out transaction', async () => {
    const hookGate = deferred();
    const hookStarted = deferred();
    const service = new YodaAccountService();
    service.on('accountWillClear', async () => {
      hookStarted.resolve();
      await hookGate.promise;
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await service.loadSessionToken();

    const signOut = service.signOut();
    await hookStarted.promise;

    await expect(service.validateSession({ forceRefresh: true })).resolves.toBe(false);
    await expect(service.getRequestSession()).rejects.toThrow('signing out');
    expect(fetchMock).not.toHaveBeenCalled();

    hookGate.resolve();
    await signOut;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/cli/auth/signout');
    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
    expect(mocks.kv.get('signedOut')).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith(accountSessionChangedChannel, undefined);
  });

  it('rejects a stored access token whose subject does not match the cached profile', async () => {
    mocks.accessToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWIifQ.';
    const service = new YodaAccountService();

    await service.loadSessionToken();

    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
    expect(mocks.accessToken).toBeNull();
    expect(mocks.refreshToken).toBeNull();
  });

  it('never revives a signed-out session from a refresh token that failed to clear', async () => {
    mocks.kv.set('signedOut', true);
    mocks.accessToken = null;
    mocks.refreshToken = 'residual-refresh';
    mocks.refreshClearError = new Error('Keychain unavailable');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();

    await service.loadSessionToken();

    await expect(service.validateSession({ forceRefresh: true })).resolves.toBe(false);
    await expect(service.getRequestSession()).rejects.toThrow('session is unavailable');
    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
    expect(mocks.refreshToken).toBe('residual-refresh');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails sign-out when neither its tombstone nor access-token deletion persists', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();
    await service.loadSessionToken();
    mocks.signedOutSetError = new Error('Database unavailable');
    mocks.accessClearError = new Error('Keychain unavailable');

    await expect(service.signOut()).rejects.toThrow('Failed to persist LovStudio sign-out state');

    expect(mocks.accessToken).not.toBeNull();
    expect(mocks.refreshToken).toBeNull();
    expect(mocks.kv.has('signedOut')).toBe(false);
    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
  });

  it('sends the refresh token so server sign-out can revoke Relay after access expiry', async () => {
    const expiredAccessToken = mocks.accessToken;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${expiredAccessToken}` });
      expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-a' });
      return Response.json({ success: true, revokedRelayDevices: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();
    await service.loadSessionToken();

    await service.signOut();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://lovstudio.test/api/cli/auth/signout'
    );
    expect(mocks.accessToken).toBeNull();
    expect(mocks.refreshToken).toBeNull();
  });

  it('calls server sign-out with only a refresh credential when access is unavailable', async () => {
    mocks.accessToken = null;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-a' });
      return Response.json({ success: true, revokedRelayDevices: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();

    await service.signOut();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://lovstudio.test/api/cli/auth/signout'
    );
    expect(mocks.refreshToken).toBeNull();
  });

  it('fails sign-out when its tombstone and legacy refresh deletion both fail', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();
    await service.loadSessionToken();
    mocks.kv.set('refreshToken', 'legacy-refresh');
    mocks.signedOutSetError = new Error('Database unavailable');
    mocks.legacyRefreshDeleteError = new Error('Legacy credential is locked');

    await expect(service.signOut()).rejects.toThrow('Failed to persist LovStudio sign-out state');

    expect(mocks.kv.get('refreshToken')).toBe('legacy-refresh');
    expect(mocks.accessToken).toBeNull();
    expect(mocks.refreshToken).toBeNull();
  });

  it('serializes sign-out behind a delayed startup credential read', async () => {
    const accessRead = deferred<string | null>();
    mocks.accessGetPromise = accessRead.promise;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new YodaAccountService();

    const loading = service.loadSessionToken();
    const signOut = service.signOut();
    accessRead.resolve('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWEifQ.');

    await loading;
    await signOut;
    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
    expect(mocks.accessToken).toBeNull();
    expect(mocks.kv.get('signedOut')).toBe(true);
  });

  it('does not let sign-in overtake a delayed startup credential read', async () => {
    const accessRead = deferred<string | null>();
    mocks.accessGetPromise = accessRead.promise;
    const service = new YodaAccountService();

    const loading = service.loadSessionToken();
    const signIn = service.signIn();
    accessRead.resolve('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWEifQ.');

    await loading;
    await expect(signIn).rejects.toThrow('Sign out before switching LovStudio accounts');
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('notifies account cleanup even when expired-credential persistence fails', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const accountCleared = vi.fn();
    const service = new YodaAccountService();
    service.on('accountCleared', accountCleared);
    await service.loadSessionToken();
    mocks.signedOutSetError = new Error('Database unavailable');
    mocks.accessClearError = new Error('Keychain unavailable');

    await expect(service.validateSession({ forceRefresh: true })).rejects.toThrow(
      'Failed to persist LovStudio sign-out state'
    );

    await vi.waitFor(() => expect(accountCleared).toHaveBeenCalledTimes(1));
    expect(mocks.emit).toHaveBeenCalledWith(accountSessionChangedChannel, undefined);
    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false });
  });

  it('keeps the local session and retries after a temporary refresh failure', async () => {
    const refreshedAccessToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWEifQ.refreshed';
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        Response.json({
          accessToken: refreshedAccessToken,
          refreshToken: 'refresh-b',
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const accountCleared = vi.fn();
    const service = new YodaAccountService();
    service.on('accountCleared', accountCleared);
    await service.loadSessionToken();

    await expect(service.validateSession({ forceRefresh: true })).resolves.toBe(false);

    expect(mocks.accessToken).not.toBeNull();
    expect(mocks.refreshToken).toBe('refresh-a');
    expect(mocks.kv.has('signedOut')).toBe(false);
    expect(mocks.emit).not.toHaveBeenCalledWith(accountSessionChangedChannel, undefined);
    expect(accountCleared).not.toHaveBeenCalled();
    await expect(service.getSession()).resolves.toMatchObject({
      isSignedIn: true,
      user: { userId: 'account-a' },
    });

    await expect(service.validateSession({ forceRefresh: true })).resolves.toBe(true);
    expect(mocks.accessToken).toBe(refreshedAccessToken);
    expect(mocks.refreshToken).toBe('refresh-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a delayed profile read instead of overwriting a newer account generation', async () => {
    const service = new YodaAccountService();
    await service.loadSessionToken();
    const accountA = mocks.kv.get('profile');
    const staleProfileRead = deferred<unknown>();
    mocks.profileGetPromise = staleProfileRead.promise;

    const session = service.getSession();
    await Promise.resolve();
    const accountB = {
      hasAccount: true,
      userId: 'account-b',
      username: 'account-b',
      name: 'Account B',
      avatarUrl: '',
      email: 'b@example.com',
      lastValidated: '2026-07-12T01:00:00.000Z',
    };
    const accountBToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhY2NvdW50LWIifQ.';
    const internals = service as unknown as {
      cachedProfile: typeof accountB;
      sessionToken: string;
      signedOut: boolean;
      rotateSessionGeneration: () => number;
    };
    mocks.kv.set('profile', accountB);
    internals.cachedProfile = accountB;
    internals.sessionToken = accountBToken;
    internals.signedOut = false;
    internals.rotateSessionGeneration();
    staleProfileRead.resolve(accountA);

    await expect(session).resolves.toMatchObject({
      isSignedIn: true,
      user: { userId: 'account-b', email: 'b@example.com' },
    });
    await expect(service.getRequestSession()).resolves.toMatchObject({
      userId: 'account-b',
      accessToken: accountBToken,
    });
  });

  it('never pairs an access token with a profile from another account', async () => {
    const service = new YodaAccountService();
    await service.loadSessionToken();
    mocks.kv.set('profile', {
      hasAccount: true,
      userId: 'account-b',
      username: 'account-b',
      name: 'Account B',
      avatarUrl: '',
      email: 'b@example.com',
      lastValidated: '2026-07-12T01:00:00.000Z',
    });

    await expect(service.getSession()).resolves.toMatchObject({ isSignedIn: false, user: null });
    await expect(service.getRequestSession()).rejects.toThrow('session changed');
    await expect(service.getValidSessionToken()).rejects.toThrow('session changed');
  });
});
