import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';

const ACCOUNT_SESSION_SECRET_KEY = 'yoda-account-token';
const ACCOUNT_REFRESH_SECRET_KEY = 'yoda-account-refresh-token';

export class AccountCredentialStore {
  async get(): Promise<string | null> {
    try {
      return await encryptedAppSecretsStore.getSecret(ACCOUNT_SESSION_SECRET_KEY);
    } catch (error) {
      log.error('Failed to retrieve session token:', error);
      return null;
    }
  }

  async set(token: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.setSecret(ACCOUNT_SESSION_SECRET_KEY, token);
    } catch (error) {
      log.error('Failed to store session token:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(ACCOUNT_SESSION_SECRET_KEY);
    } catch (error) {
      log.error('Failed to clear session token:', error);
      throw error;
    }
  }
}

export const accountCredentialStore = new AccountCredentialStore();

export class AccountRefreshCredentialStore {
  async get(): Promise<string | null> {
    return encryptedAppSecretsStore.getSecret(ACCOUNT_REFRESH_SECRET_KEY);
  }

  async set(token: string): Promise<void> {
    await encryptedAppSecretsStore.setSecret(ACCOUNT_REFRESH_SECRET_KEY, token);
  }

  async clear(): Promise<void> {
    await encryptedAppSecretsStore.deleteSecret(ACCOUNT_REFRESH_SECRET_KEY);
  }
}

export const accountRefreshCredentialStore = new AccountRefreshCredentialStore();
