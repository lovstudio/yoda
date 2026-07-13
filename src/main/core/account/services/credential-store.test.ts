import { describe, expect, it, vi } from 'vitest';
import { AccountCredentialStore } from './credential-store';

const mocks = vi.hoisted(() => ({
  deleteSecret: vi.fn(),
}));

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: mocks.deleteSecret,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn() },
}));

describe('AccountCredentialStore', () => {
  it('reports a failed access-token deletion to the sign-out transaction', async () => {
    mocks.deleteSecret.mockRejectedValueOnce(new Error('Keychain unavailable'));
    const store = new AccountCredentialStore();

    await expect(store.clear()).rejects.toThrow('Keychain unavailable');
  });
});
