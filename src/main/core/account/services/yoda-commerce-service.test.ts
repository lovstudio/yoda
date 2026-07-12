import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YodaCommerceService } from './yoda-commerce-service';

const mocks = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  return {
    currentUserId: 'account-1',
    currentGeneration: 1,
    secrets,
    getSecret: vi.fn(async (key: string) => secrets.get(key) ?? null),
    setSecret: vi.fn(async (key: string, value: string) => {
      secrets.set(key, value);
    }),
    deleteSecret: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
    request: vi.fn(),
    getRequestSession: vi.fn(async () => ({
      userId: mocks.currentUserId,
      generation: mocks.currentGeneration,
      accessToken: `token-${mocks.currentUserId}`,
      signal: new AbortController().signal,
    })),
  };
});

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: mocks.getSecret,
    setSecret: mocks.setSecret,
    deleteSecret: mocks.deleteSecret,
  },
}));

vi.mock('./lovstudio-api-client', () => ({
  lovStudioApiClient: { request: mocks.request },
  LovStudioApiError: class LovStudioApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock('./yoda-account-service', () => ({
  yodaAccountService: { getRequestSession: mocks.getRequestSession },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('YodaCommerceService', () => {
  beforeEach(() => {
    mocks.secrets.clear();
    mocks.currentUserId = 'account-1';
    mocks.currentGeneration = 1;
    vi.clearAllMocks();
  });

  it('uses one activation request and one idempotency key for concurrent callers', async () => {
    const activation = {
      idempotent: false,
      balance: 10,
      credits_spent: 990,
      starts_at: '2026-07-12T00:00:00.000Z',
      ends_at: '2026-08-11T00:00:00.000Z',
    };
    const pending = deferred<typeof activation>();
    mocks.request.mockImplementation(() => pending.promise);
    const service = new YodaCommerceService();

    const first = service.activateRelayPass();
    const second = service.activateRelayPass();

    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.setSecret).toHaveBeenCalledTimes(1);
    const persistedKey = mocks.setSecret.mock.calls[0]?.[1];
    expect(persistedKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/yoda/relay/activate',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': persistedKey },
      },
      { expectedUserId: 'account-1', expectedGeneration: 1 }
    );

    pending.resolve(activation);
    await expect(first).resolves.toEqual(activation);
    await expect(second).resolves.toEqual(activation);
  });

  it('does not share an in-flight activation between different accounts', async () => {
    const firstPending = deferred<{
      idempotent: boolean;
      balance: number;
      credits_spent: number;
      starts_at: string;
      ends_at: string;
    }>();
    const secondActivation = {
      idempotent: false,
      balance: 20,
      credits_spent: 990,
      starts_at: '2026-07-13T00:00:00.000Z',
      ends_at: '2026-08-12T00:00:00.000Z',
    };
    mocks.request
      .mockImplementationOnce(() => firstPending.promise)
      .mockResolvedValueOnce(secondActivation);
    const service = new YodaCommerceService();

    const first = service.activateRelayPass();
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    mocks.currentUserId = 'account-2';
    mocks.currentGeneration = 2;
    const second = service.activateRelayPass();

    await expect(second).resolves.toEqual(secondActivation);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    firstPending.resolve({
      idempotent: false,
      balance: 10,
      credits_spent: 990,
      starts_at: '2026-07-12T00:00:00.000Z',
      ends_at: '2026-08-11T00:00:00.000Z',
    });
    await expect(first).resolves.toMatchObject({ balance: 10 });
  });

  it('keeps activation bound to its originating account across secret-store latency', async () => {
    const secretRead = deferred<string | null>();
    mocks.getSecret.mockImplementationOnce(() => secretRead.promise);
    mocks.request.mockImplementation(
      async (
        _path: string,
        _init: RequestInit,
        options: { expectedUserId?: string; expectedGeneration?: number }
      ) => {
        if (
          options.expectedUserId !== mocks.currentUserId ||
          options.expectedGeneration !== mocks.currentGeneration
        ) {
          throw new Error('LovStudio account session changed');
        }
        return {};
      }
    );
    const service = new YodaCommerceService();

    const activation = service.activateRelayPass();
    await vi.waitFor(() => expect(mocks.getSecret).toHaveBeenCalledTimes(1));
    mocks.currentUserId = 'account-2';
    mocks.currentGeneration = 2;
    secretRead.resolve(null);

    await expect(activation).rejects.toThrow('LovStudio account session changed');
    expect(mocks.request).toHaveBeenCalledWith('/api/yoda/relay/activate', expect.any(Object), {
      expectedUserId: 'account-1',
      expectedGeneration: 1,
    });
  });
});
