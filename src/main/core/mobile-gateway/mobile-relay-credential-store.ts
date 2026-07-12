import { createHash } from 'node:crypto';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';

const MOBILE_RELAY_CREDENTIALS_KEY = 'yoda-mobile-relay-credentials';
const MOBILE_RELAY_STATE_KEY = 'revocationState';

export type MobileRelayCredentials = {
  accountUserId: string;
  deviceId: string;
  deviceName: string;
  hostToken: string;
  relayBaseUrl: string;
};

export type PendingRelayRevocation = {
  accountUserId: string;
  deviceId: string;
};

type MobileRelayRevocationState = {
  revokedFingerprints: string[];
  pendingRevocations: PendingRelayRevocation[];
};

const EMPTY_REVOCATION_STATE: MobileRelayRevocationState = {
  revokedFingerprints: [],
  pendingRevocations: [],
};

const mobileRelayState = new KV<{ revocationState: MobileRelayRevocationState }>(
  'mobile-relay-state'
);

export class MobileRelayCredentialStore {
  async get(): Promise<MobileRelayCredentials | null> {
    const [raw, state] = await Promise.all([
      encryptedAppSecretsStore.getSecret(MOBILE_RELAY_CREDENTIALS_KEY),
      this.getRevocationState(),
    ]);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<MobileRelayCredentials>;
      if (
        !value.accountUserId ||
        !value.deviceId ||
        !value.deviceName ||
        !value.hostToken ||
        !value.relayBaseUrl
      )
        return null;
      const credentials = value as MobileRelayCredentials;
      if (state.revokedFingerprints.includes(credentialFingerprint(credentials))) {
        // Preserve the tombstone and stale ciphertext together. Removing the
        // ciphertext here can race with a newly registered credential.
        return null;
      }
      return credentials;
    } catch {
      return null;
    }
  }

  async set(credentials: MobileRelayCredentials): Promise<void> {
    await encryptedAppSecretsStore.setSecret(
      MOBILE_RELAY_CREDENTIALS_KEY,
      JSON.stringify(credentials)
    );
  }

  clear(): Promise<void> {
    return encryptedAppSecretsStore.deleteSecret(MOBILE_RELAY_CREDENTIALS_KEY);
  }

  async revoke(credentials: MobileRelayCredentials): Promise<void> {
    const state = await this.getRevocationState();
    const nextState: MobileRelayRevocationState = {
      revokedFingerprints: [
        ...new Set([...state.revokedFingerprints, credentialFingerprint(credentials)]),
      ].slice(-32),
      pendingRevocations: [
        ...state.pendingRevocations.filter(
          (item) =>
            item.accountUserId !== credentials.accountUserId ||
            item.deviceId !== credentials.deviceId
        ),
        { accountUserId: credentials.accountUserId, deviceId: credentials.deviceId },
      ].slice(-16),
    };
    await this.persistTombstone(nextState);
  }

  async tombstone(credentials: MobileRelayCredentials): Promise<void> {
    const state = await this.getRevocationState();
    await this.persistTombstone({
      ...state,
      revokedFingerprints: [
        ...new Set([...state.revokedFingerprints, credentialFingerprint(credentials)]),
      ].slice(-32),
    });
  }

  async getPendingRevocations(): Promise<PendingRelayRevocation[]> {
    return (await this.getRevocationState()).pendingRevocations;
  }

  async confirmRevocation(accountUserId: string, deviceId: string): Promise<void> {
    const state = await this.getRevocationState();
    const pendingRevocations = state.pendingRevocations.filter(
      (item) => item.accountUserId !== accountUserId || item.deviceId !== deviceId
    );
    if (pendingRevocations.length === state.pendingRevocations.length) return;
    await mobileRelayState.setStrict(MOBILE_RELAY_STATE_KEY, {
      ...state,
      pendingRevocations,
    });
  }

  private async persistTombstone(state: MobileRelayRevocationState): Promise<void> {
    // Persist the retry/tombstone record before removing the only durable copy
    // of the device identity. If this write fails, leave the encrypted
    // credential intact so a later revoke can still recover and retry it.
    await mobileRelayState.setStrict(MOBILE_RELAY_STATE_KEY, state);
    await encryptedAppSecretsStore.deleteSecret(MOBILE_RELAY_CREDENTIALS_KEY);
  }

  private async getRevocationState(): Promise<MobileRelayRevocationState> {
    const value = await mobileRelayState.get(MOBILE_RELAY_STATE_KEY);
    if (
      !value ||
      !Array.isArray(value.revokedFingerprints) ||
      !Array.isArray(value.pendingRevocations)
    ) {
      return EMPTY_REVOCATION_STATE;
    }
    return {
      revokedFingerprints: value.revokedFingerprints.filter(
        (item): item is string => typeof item === 'string' && /^[0-9a-f]{64}$/.test(item)
      ),
      pendingRevocations: value.pendingRevocations.filter(
        (item): item is PendingRelayRevocation =>
          typeof item?.accountUserId === 'string' && typeof item?.deviceId === 'string'
      ),
    };
  }
}

function credentialFingerprint(credentials: MobileRelayCredentials): string {
  return createHash('sha256')
    .update(`${credentials.accountUserId}\0${credentials.deviceId}\0${credentials.hostToken}`)
    .digest('hex');
}

export const mobileRelayCredentialStore = new MobileRelayCredentialStore();
