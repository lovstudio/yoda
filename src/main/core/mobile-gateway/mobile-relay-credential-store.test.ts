import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MobileRelayCredentialStore,
  type MobileRelayCredentials,
} from './mobile-relay-credential-store';

const mocks = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  rawSecret: null as string | null,
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  strictSetError: null as Error | null,
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    async get(key: string) {
      return mocks.kv.get(key);
    }
    async set(key: string, value: unknown) {
      mocks.kv.set(key, value);
    }
    async setStrict(key: string, value: unknown) {
      if (mocks.strictSetError) throw mocks.strictSetError;
      mocks.kv.set(key, value);
    }
    async del(key: string) {
      mocks.kv.delete(key);
    }
    async delStrict(key: string) {
      mocks.kv.delete(key);
    }
  },
}));

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: mocks.getSecret,
    setSecret: mocks.setSecret,
    deleteSecret: mocks.deleteSecret,
  },
}));

const credentials: MobileRelayCredentials = {
  accountUserId: 'account-1',
  deviceId: 'device-1',
  deviceName: 'Desktop',
  hostToken: `yrh_${'a'.repeat(43)}`,
  relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
};

describe('MobileRelayCredentialStore', () => {
  beforeEach(() => {
    mocks.kv.clear();
    mocks.rawSecret = JSON.stringify(credentials);
    mocks.strictSetError = null;
    vi.clearAllMocks();
    mocks.getSecret.mockImplementation(async () => mocks.rawSecret);
    mocks.setSecret.mockImplementation(async (_key: string, value: string) => {
      mocks.rawSecret = value;
    });
    mocks.deleteSecret.mockImplementation(async () => {
      mocks.rawSecret = null;
    });
  });

  it('tombstones revoked credentials even when Keychain deletion fails', async () => {
    mocks.deleteSecret.mockRejectedValueOnce(new Error('Keychain unavailable'));
    const store = new MobileRelayCredentialStore();

    await expect(store.revoke(credentials)).rejects.toThrow('Keychain unavailable');
    expect(mocks.rawSecret).not.toBeNull();
    await expect(store.get()).resolves.toBeNull();
    expect(mocks.deleteSecret).toHaveBeenCalledTimes(1);
    await expect(store.getPendingRevocations()).resolves.toEqual([
      { accountUserId: 'account-1', deviceId: 'device-1' },
    ]);
  });

  it('keeps encrypted credentials when the durable revocation outbox cannot be written', async () => {
    mocks.strictSetError = new Error('Database unavailable');
    const store = new MobileRelayCredentialStore();

    await expect(store.revoke(credentials)).rejects.toThrow('Database unavailable');

    expect(mocks.rawSecret).toBe(JSON.stringify(credentials));
    expect(mocks.deleteSecret).not.toHaveBeenCalled();
  });

  it('keeps the fingerprint tombstone after a remote revocation is confirmed', async () => {
    const store = new MobileRelayCredentialStore();
    await store.revoke(credentials);

    await store.confirmRevocation('account-1', 'device-1');

    await expect(store.getPendingRevocations()).resolves.toEqual([]);
    mocks.rawSecret = JSON.stringify(credentials);
    await expect(store.get()).resolves.toBeNull();
  });
});
