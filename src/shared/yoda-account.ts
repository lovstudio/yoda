export type YodaRelayAccessStatus = 'none' | 'trial' | 'active' | 'expired' | 'revoked';
export type YodaRelayDeviceStatus = 'online' | 'offline' | 'revoked';

export type YodaRelayDevice = {
  id: string;
  name: string;
  status: YodaRelayDeviceStatus;
  lastSeenAt: string | null;
  createdAt: string;
};

export type YodaRelayAccess = {
  status: YodaRelayAccessStatus;
  enabled: boolean;
  accessEndsAt: string | null;
};

export type YodaCommerceSnapshot = {
  user: { id: string; email: string };
  credits: { balance: number; purchaseUrl: string };
  relay: YodaRelayAccess & {
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    paidUntil: string | null;
    configured: boolean;
    lastActivationKey: string | null;
    devices: YodaRelayDevice[];
  };
  offer: { trialDays: number; priceCredits: number; periodDays: number };
};

export type YodaRelayRegistration = {
  device: { id: string; name: string; created_at: string };
  registrationId: string;
  hostToken: string;
  pairingCode: string;
  pairingExpiresAt: string;
  relayBaseUrl: string;
};

export type YodaRelayActivation = {
  idempotent: boolean;
  balance: number;
  credits_spent: number;
  starts_at: string;
  ends_at: string;
};

export type YodaApiErrorPayload = {
  error: {
    code: string;
    message: string;
    required?: number;
    balance?: number;
    purchaseUrl?: string;
  };
};
