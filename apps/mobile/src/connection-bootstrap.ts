import { parseMobilePairingUrl } from '@lovstudio/yoda-protocol/mobile-api';
import { parseMobileRelayPairingUrl } from '@lovstudio/yoda-protocol/mobile-relay';
import type { MobileConnection } from './api-client';

export type MobileConnectionBootstrapFallback = {
  connection: MobileConnection;
  shouldPersist: boolean;
};

export function explicitMobilePairingUrl(initialUrl: string | null): string | null {
  if (!initialUrl) return null;
  return parseMobilePairingUrl(initialUrl) || parseMobileRelayPairingUrl(initialUrl)
    ? initialUrl
    : null;
}

export function selectMobileConnectionBootstrapFallback(
  savedConnection: MobileConnection | null,
  developmentConnection: MobileConnection | null
): MobileConnectionBootstrapFallback | null {
  if (savedConnection) {
    return { connection: savedConnection, shouldPersist: false };
  }
  if (developmentConnection) {
    return { connection: developmentConnection, shouldPersist: true };
  }
  return null;
}
