import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { CredentialConnectionService, requiredCredential } from './credential-connection-service';

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
}));

describe('CredentialConnectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifies and encrypts normalized credentials before reporting connected', async () => {
    const verify = vi.fn().mockResolvedValue({ displayName: 'Workspace' });
    const service = new CredentialConnectionService({
      provider: 'notion',
      secretKey: 'test-notion',
      normalize: (credentials: { apiToken: string }) => ({
        apiToken: requiredCredential(credentials.apiToken, 'Token required.'),
      }),
      verify,
    });

    await expect(service.saveCredentials({ apiToken: '  ntn_test  ' })).resolves.toEqual({
      success: true,
    });
    expect(encryptedAppSecretsStore.setSecret).toHaveBeenCalledWith(
      'test-notion',
      JSON.stringify({ apiToken: 'ntn_test' })
    );
    await expect(service.checkConnection()).resolves.toMatchObject({
      connected: true,
      displayName: 'Workspace',
    });
    expect(verify).toHaveBeenLastCalledWith({ apiToken: 'ntn_test' });
  });

  it('does not persist credentials when verification fails', async () => {
    const service = new CredentialConnectionService({
      provider: 'asana',
      secretKey: 'test-asana',
      normalize: (credentials: { accessToken: string }) => credentials,
      verify: vi.fn().mockRejectedValue(new Error('Authentication failed.')),
    });

    await expect(service.saveCredentials({ accessToken: 'bad' })).resolves.toEqual({
      success: false,
      error: 'Authentication failed.',
    });
    expect(encryptedAppSecretsStore.setSecret).not.toHaveBeenCalled();
  });
});
