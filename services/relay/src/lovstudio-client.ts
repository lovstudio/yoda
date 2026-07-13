export type CredentialKind = 'host' | 'mobile';

export type AuthorizedCredential = {
  accountId: string;
  deviceId: string;
  credentialId?: string;
  entitlementExpiresAt?: string;
};

export type PairingExchange = {
  deviceId: string;
  mobileToken: string;
  expiresAt?: string;
};

export interface LovStudioControlPlane {
  authorize(input: {
    kind: CredentialKind;
    token: string;
    deviceId: string;
  }): Promise<AuthorizedCredential>;
  pair(input: { deviceId: string; pairingCode: string }): Promise<PairingExchange>;
}

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type LovStudioClientOptions = {
  baseUrl: string;
  serviceToken: string;
  authorizePath: string;
  pairPath: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function errorForStatus(status: number): ControlPlaneError {
  if (status === 401 || status === 403) {
    return new ControlPlaneError(401, 'invalid_credential', 'Relay credential is invalid.');
  }
  if (status === 402) {
    return new ControlPlaneError(402, 'payment_required', 'An active Yoda Relay pass is required.');
  }
  if (status === 404) {
    return new ControlPlaneError(404, 'device_not_found', 'Relay device was not found.');
  }
  if (status === 409) {
    return new ControlPlaneError(
      409,
      'pairing_unavailable',
      'Pairing code is no longer available.'
    );
  }
  if (status === 410) {
    return new ControlPlaneError(410, 'pairing_expired', 'Pairing code has expired.');
  }
  if (status === 429) {
    return new ControlPlaneError(429, 'rate_limited', 'Too many Relay requests. Try again later.');
  }
  return new ControlPlaneError(503, 'control_plane_unavailable', 'LovStudio is unavailable.');
}

export class LovStudioClient implements LovStudioControlPlane {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LovStudioClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async authorize(input: {
    kind: CredentialKind;
    token: string;
    deviceId: string;
  }): Promise<AuthorizedCredential> {
    const value = await this.post(this.options.authorizePath, input);
    if (
      !isRecord(value) ||
      value.authorized !== true ||
      typeof value.accountId !== 'string' ||
      !value.accountId ||
      typeof value.deviceId !== 'string' ||
      !value.deviceId
    ) {
      throw new ControlPlaneError(
        503,
        'invalid_control_plane_response',
        'LovStudio returned an invalid authorization response.'
      );
    }
    return {
      accountId: value.accountId,
      deviceId: value.deviceId,
      credentialId: optionalString(value.credentialId),
      entitlementExpiresAt: optionalString(value.entitlementExpiresAt),
    };
  }

  async pair(input: { deviceId: string; pairingCode: string }): Promise<PairingExchange> {
    const value = await this.post(this.options.pairPath, input);
    if (
      !isRecord(value) ||
      typeof value.deviceId !== 'string' ||
      !value.deviceId ||
      typeof value.mobileToken !== 'string' ||
      !value.mobileToken
    ) {
      throw new ControlPlaneError(
        503,
        'invalid_control_plane_response',
        'LovStudio returned an invalid pairing response.'
      );
    }
    return {
      deviceId: value.deviceId,
      mobileToken: value.mobileToken,
      expiresAt: optionalString(value.expiresAt),
    };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, `${this.options.baseUrl}/`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new ControlPlaneError(503, 'control_plane_unavailable', 'LovStudio is unavailable.');
    }
    if (!response.ok) throw errorForStatus(response.status);
    try {
      return await response.json();
    } catch {
      throw new ControlPlaneError(
        503,
        'invalid_control_plane_response',
        'LovStudio returned an invalid response.'
      );
    }
  }
}
