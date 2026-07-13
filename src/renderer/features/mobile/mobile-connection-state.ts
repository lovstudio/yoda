import type { MobileGatewayConnectionInfo } from '@shared/mobile-api';
import type { MobileRelayStatus } from '@shared/mobile-relay';

export type RelayConnectionPhase =
  | 'loading'
  | 'gateway-unavailable'
  | 'account-unavailable'
  | 'load-error'
  | 'needs-sign-in'
  | 'needs-enable'
  | 'connecting'
  | 'offline'
  | 'ready'
  | 'pairing-ready'
  | 'pairing-expired';

export type RelayConnectionUiState = {
  phase: RelayConnectionPhase;
  pairingUrl: string | null;
};

export function hasReachableLocalGateway(
  connection: MobileGatewayConnectionInfo | undefined
): boolean {
  return Boolean(
    connection?.running &&
      connection.token &&
      connection.pairingUrl &&
      connection.urls.length > 0 &&
      connection.connectionKind !== 'local'
  );
}

export function deriveRelayConnectionUiState({
  gatewayLoading,
  gatewayReady,
  accountLoading,
  accountUnavailable,
  isSignedIn,
  relayLoading,
  relayUnavailable,
  relay,
  now = Date.now(),
}: {
  gatewayLoading: boolean;
  gatewayReady: boolean;
  accountLoading: boolean;
  accountUnavailable: boolean;
  isSignedIn: boolean;
  relayLoading: boolean;
  relayUnavailable: boolean;
  relay: MobileRelayStatus | undefined;
  now?: number;
}): RelayConnectionUiState {
  if (gatewayLoading || accountLoading || relayLoading) {
    return { phase: 'loading', pairingUrl: null };
  }
  if (!gatewayReady) return { phase: 'gateway-unavailable', pairingUrl: null };
  if (accountUnavailable) return { phase: 'account-unavailable', pairingUrl: null };
  if (!isSignedIn) return { phase: 'needs-sign-in', pairingUrl: null };
  if (relayUnavailable) return { phase: 'load-error', pairingUrl: null };
  if (!relay?.configured) return { phase: 'needs-enable', pairingUrl: null };
  if (relay.connecting) return { phase: 'connecting', pairingUrl: null };
  if (!relay.connected) return { phase: 'offline', pairingUrl: null };

  const expiresAt = relay.pairingExpiresAt ? Date.parse(relay.pairingExpiresAt) : Number.NaN;
  if (relay.pairingUrl && Number.isFinite(expiresAt) && expiresAt > now) {
    return { phase: 'pairing-ready', pairingUrl: relay.pairingUrl };
  }
  if (Number.isFinite(expiresAt) && expiresAt <= now) {
    return { phase: 'pairing-expired', pairingUrl: null };
  }
  return { phase: 'ready', pairingUrl: null };
}
