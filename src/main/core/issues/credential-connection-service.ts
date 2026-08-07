import {
  ISSUE_PROVIDER_CAPABILITIES,
  type ConnectionStatus,
  type IssueProviderType,
} from '@shared/issue-providers';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';

type VerifiedConnection = {
  displayName?: string;
};

type CredentialConnectionConfig<TCredentials extends object> = {
  provider: IssueProviderType;
  secretKey: string;
  normalize: (credentials: TCredentials) => TCredentials;
  verify: (credentials: TCredentials) => Promise<VerifiedConnection>;
  toErrorMessage?: (error: unknown, fallback: string) => string;
};

function defaultErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export class CredentialConnectionService<TCredentials extends object> {
  private cachedCredentials: TCredentials | null | undefined;

  constructor(private readonly config: CredentialConnectionConfig<TCredentials>) {}

  async saveCredentials(credentials: TCredentials): Promise<{ success: boolean; error?: string }> {
    try {
      const normalized = this.config.normalize(credentials);
      await this.config.verify(normalized);
      await encryptedAppSecretsStore.setSecret(this.config.secretKey, JSON.stringify(normalized));
      this.cachedCredentials = normalized;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, `Failed to connect ${this.config.provider}.`),
      };
    }
  }

  async clearCredentials(): Promise<{ success: boolean; error?: string }> {
    try {
      await encryptedAppSecretsStore.deleteSecret(this.config.secretKey);
      this.cachedCredentials = null;
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.errorMessage(error, `Failed to disconnect ${this.config.provider}.`),
      };
    }
  }

  async checkConnection(): Promise<ConnectionStatus> {
    const capabilities = ISSUE_PROVIDER_CAPABILITIES[this.config.provider];
    const credentials = await this.getCredentials();
    if (!credentials) return { connected: false, capabilities };

    try {
      const verified = await this.config.verify(credentials);
      return {
        connected: true,
        displayName: verified.displayName,
        capabilities,
      };
    } catch (error) {
      return {
        connected: false,
        error: this.errorMessage(error, `Failed to verify ${this.config.provider} connection.`),
        capabilities,
      };
    }
  }

  async getCredentials(): Promise<TCredentials | null> {
    if (this.cachedCredentials !== undefined) return this.cachedCredentials;

    try {
      const stored = await encryptedAppSecretsStore.getSecret(this.config.secretKey);
      if (!stored) {
        this.cachedCredentials = null;
        return null;
      }
      this.cachedCredentials = this.config.normalize(JSON.parse(stored) as TCredentials);
      return this.cachedCredentials;
    } catch (error) {
      log.error(`Failed to read ${this.config.provider} credentials from secure storage:`, error);
      this.cachedCredentials = null;
      return null;
    }
  }

  errorMessage(error: unknown, fallback: string): string {
    return (this.config.toErrorMessage ?? defaultErrorMessage)(error, fallback);
  }
}

export function requiredCredential(value: string | undefined, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}
