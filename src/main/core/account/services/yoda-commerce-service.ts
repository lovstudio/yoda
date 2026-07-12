import { randomBytes, randomUUID } from 'node:crypto';
import type {
  YodaCommerceSnapshot,
  YodaRelayAccess,
  YodaRelayActivation,
  YodaRelayRegistration,
} from '@shared/yoda-account';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { log } from '@main/lib/logger';
import { lovStudioApiClient, LovStudioApiError } from './lovstudio-api-client';
import { yodaAccountService } from './yoda-account-service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function activationSecretKey(userId: string): string {
  return `yoda-relay-activation-idempotency:${userId}`;
}

function registrationSecretKey(userId: string): string {
  return `yoda-relay-device-registration:${userId}`;
}

type PendingRelayRegistration = {
  registrationId: string;
  hostToken: string;
};

function parsePendingRegistration(value: string | null): PendingRelayRegistration | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingRelayRegistration>;
    if (
      !parsed.registrationId ||
      !UUID_PATTERN.test(parsed.registrationId) ||
      !parsed.hostToken ||
      !/^yrh_[A-Za-z0-9_-]{43}$/.test(parsed.hostToken)
    ) {
      return null;
    }
    return { registrationId: parsed.registrationId, hostToken: parsed.hostToken };
  } catch {
    return null;
  }
}

function isDefinitiveRequestFailure(error: unknown): boolean {
  return (
    error instanceof LovStudioApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    ![408, 425, 429].includes(error.status)
  );
}

export class YodaCommerceService {
  private readonly activationPromises = new Map<string, Promise<YodaRelayActivation>>();

  async getSnapshot(): Promise<YodaCommerceSnapshot> {
    const snapshot = await lovStudioApiClient.request<YodaCommerceSnapshot>('/api/yoda/account');
    const secretKey = activationSecretKey(snapshot.user.id);
    const pendingKey = await encryptedAppSecretsStore.getSecret(secretKey);
    if (pendingKey && pendingKey === snapshot.relay.lastActivationKey) {
      await this.clearActivationKey(secretKey);
    }
    return snapshot;
  }

  startRelayTrial(): Promise<{ relay: YodaRelayAccess }> {
    return lovStudioApiClient.request('/api/yoda/relay/trial', { method: 'POST' });
  }

  async activateRelayPass(): Promise<YodaRelayActivation> {
    const requestSession = await yodaAccountService.getRequestSession();
    const accountUserId = requestSession.userId;
    const existing = this.activationPromises.get(accountUserId);
    if (existing) return existing;
    const activation = this.activateRelayPassInternal(
      accountUserId,
      requestSession.generation
    ).finally(() => {
      if (this.activationPromises.get(accountUserId) === activation) {
        this.activationPromises.delete(accountUserId);
      }
    });
    this.activationPromises.set(accountUserId, activation);
    return activation;
  }

  private async activateRelayPassInternal(
    accountUserId: string,
    accountGeneration: number
  ): Promise<YodaRelayActivation> {
    const secretKey = activationSecretKey(accountUserId);
    let idempotencyKey = await encryptedAppSecretsStore.getSecret(secretKey);
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
      idempotencyKey = randomUUID();
      await encryptedAppSecretsStore.setSecret(secretKey, idempotencyKey);
    }

    try {
      const activation = await lovStudioApiClient.request<YodaRelayActivation>(
        '/api/yoda/relay/activate',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
        },
        { expectedUserId: accountUserId, expectedGeneration: accountGeneration }
      );
      return activation;
    } catch (error) {
      if (isDefinitiveRequestFailure(error)) await this.clearActivationKey(secretKey);
      throw error;
    }
  }

  async registerRelayDevice(name: string, signal?: AbortSignal): Promise<YodaRelayRegistration> {
    const requestSession = await yodaAccountService.getRequestSession();
    const secretKey = registrationSecretKey(requestSession.userId);
    let pending = parsePendingRegistration(await encryptedAppSecretsStore.getSecret(secretKey));
    if (!pending) {
      pending = {
        registrationId: randomUUID(),
        hostToken: `yrh_${randomBytes(32).toString('base64url')}`,
      };
      await encryptedAppSecretsStore.setSecret(secretKey, JSON.stringify(pending));
    }

    try {
      const registration = await lovStudioApiClient.request<
        Omit<YodaRelayRegistration, 'hostToken' | 'registrationId'>
      >(
        '/api/yoda/relay/devices',
        {
          method: 'POST',
          body: JSON.stringify({ name, ...pending }),
          signal,
        },
        {
          expectedUserId: requestSession.userId,
          expectedGeneration: requestSession.generation,
        }
      );
      return {
        ...registration,
        registrationId: pending.registrationId,
        hostToken: pending.hostToken,
      };
    } catch (error) {
      if (isDefinitiveRequestFailure(error)) await this.clearRegistrationKey(secretKey);
      throw error;
    }
  }

  async confirmRelayDeviceRegistration(
    accountUserId: string,
    registrationId: string
  ): Promise<void> {
    const secretKey = registrationSecretKey(accountUserId);
    const pending = parsePendingRegistration(await encryptedAppSecretsStore.getSecret(secretKey));
    if (pending?.registrationId === registrationId) {
      await this.clearRegistrationKey(secretKey);
    }
  }

  createRelayPairing(
    deviceId: string,
    signal?: AbortSignal
  ): Promise<{ pairingCode: string; pairingExpiresAt: string }> {
    return lovStudioApiClient.request(
      `/api/yoda/relay/devices/${encodeURIComponent(deviceId)}/pairing`,
      { method: 'POST', signal }
    );
  }

  async revokeRelayDevice(
    deviceId: string,
    signal?: AbortSignal,
    allowDuringSignOut = false
  ): Promise<void> {
    await lovStudioApiClient.request(
      `/api/yoda/relay/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE', signal },
      { allowDuringSignOut }
    );
  }

  private async clearActivationKey(secretKey: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(secretKey);
    } catch (error) {
      // Keeping the key is safe: a retry will receive the original idempotent result.
      log.warn('Failed to clear Relay activation idempotency key', error);
    }
  }

  private async clearRegistrationKey(secretKey: string): Promise<void> {
    try {
      await encryptedAppSecretsStore.deleteSecret(secretKey);
    } catch (error) {
      // A stale pending registration is safe because the backend binds it to the same host token.
      log.warn('Failed to clear Relay device registration key', error);
    }
  }
}

export const yodaCommerceService = new YodaCommerceService();
