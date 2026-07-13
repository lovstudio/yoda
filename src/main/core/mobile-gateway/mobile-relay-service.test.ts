import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_RELAY_BASE_URL, MOBILE_RELAY_HOST_CLOSE_CODE } from '@shared/mobile-relay';
import type {
  MobileRelayCredentials,
  PendingRelayRevocation,
} from './mobile-relay-credential-store';
import { MobileRelayService } from './mobile-relay-service';

const mocks = vi.hoisted(() => ({
  session: {
    isSignedIn: true,
    hasAccount: true,
    user: { userId: 'account-1' },
  } as {
    isSignedIn: boolean;
    hasAccount: boolean;
    user: { userId: string } | null;
  },
  getSession: vi.fn(),
  getRequestSession: vi.fn(),
  registerRelayDevice: vi.fn(),
  confirmRelayDeviceRegistration: vi.fn(async () => undefined),
  createRelayPairing: vi.fn(),
  revokeRelayDevice: vi.fn(async () => undefined),
  credentialGet: vi.fn<() => Promise<MobileRelayCredentials | null>>(async () => null),
  credentialSet: vi.fn<(credentials: MobileRelayCredentials) => Promise<void>>(async () => {}),
  credentialClear: vi.fn<() => Promise<void>>(async () => {}),
  credentialRevoke: vi.fn<(credentials: MobileRelayCredentials) => Promise<void>>(async () => {}),
  credentialTombstone: vi.fn<(credentials: MobileRelayCredentials) => Promise<void>>(
    async () => {}
  ),
  getPendingRevocations: vi.fn<() => Promise<PendingRelayRevocation[]>>(async () => []),
  confirmRevocation: vi.fn<(accountUserId: string, deviceId: string) => Promise<void>>(
    async () => {}
  ),
  webSocketConstructor: vi.fn(),
  sockets: [] as Array<{
    emitTest: (event: string, ...args: unknown[]) => void;
    terminate: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('ws', () => ({
  default: class FakeWebSocket {
    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    terminate = vi.fn();

    constructor(...args: unknown[]) {
      mocks.webSocketConstructor(...args);
      mocks.sockets.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emitTest(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    close() {}
  },
}));

vi.mock('@main/core/account/services/yoda-account-service', () => ({
  yodaAccountService: {
    getSession: mocks.getSession,
    getRequestSession: mocks.getRequestSession,
  },
}));

vi.mock('@main/core/account/services/yoda-commerce-service', () => ({
  yodaCommerceService: {
    registerRelayDevice: mocks.registerRelayDevice,
    confirmRelayDeviceRegistration: mocks.confirmRelayDeviceRegistration,
    createRelayPairing: mocks.createRelayPairing,
    revokeRelayDevice: mocks.revokeRelayDevice,
  },
}));

vi.mock('./mobile-relay-credential-store', () => ({
  mobileRelayCredentialStore: {
    get: mocks.credentialGet,
    set: mocks.credentialSet,
    clear: mocks.credentialClear,
    revoke: mocks.credentialRevoke,
    tombstone: mocks.credentialTombstone,
    getPendingRevocations: mocks.getPendingRevocations,
    confirmRevocation: mocks.confirmRevocation,
  },
}));

vi.mock('./mobile-gateway-service', () => ({
  mobileGatewayService: {
    getRelayLoopbackConnection: vi.fn(() => ({ baseUrl: 'http://127.0.0.1:1234' })),
  },
}));

vi.mock('./mobile-relay-request-bridge', () => ({
  MobileRelayRequestBridge: class {
    cancelAll() {}
    handle() {}
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('MobileRelayService account lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sockets.length = 0;
    mocks.session = {
      isSignedIn: true,
      hasAccount: true,
      user: { userId: 'account-1' },
    };
    mocks.getSession.mockImplementation(async () => mocks.session);
    mocks.getRequestSession.mockResolvedValue({
      userId: 'account-1',
      accessToken: 'access-token',
      generation: 1,
      signal: new AbortController().signal,
    });
    mocks.credentialGet.mockResolvedValue(null);
    mocks.getPendingRevocations.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the refresh-capable request session before registering Relay', async () => {
    mocks.session = {
      isSignedIn: true,
      hasAccount: true,
      user: { userId: 'account-1' },
    };
    mocks.registerRelayDevice.mockResolvedValue({
      device: { id: 'device-1', name: 'Test Desktop', created_at: '2026-07-13T00:00:00Z' },
      registrationId: '11111111-1111-4111-8111-111111111111',
      hostToken: `yrh_${'a'.repeat(43)}`,
      pairingCode: `yrp_${'b'.repeat(43)}`,
      pairingExpiresAt: '2026-07-13T00:10:00Z',
      relayBaseUrl: MOBILE_RELAY_BASE_URL,
    });
    const service = new MobileRelayService();

    await service.enable('Test Desktop');

    expect(mocks.getRequestSession).toHaveBeenCalledTimes(1);
    expect(mocks.registerRelayDevice).toHaveBeenCalledWith('Test Desktop', expect.any(AbortSignal));
    expect(mocks.credentialSet).toHaveBeenCalledWith(
      expect.objectContaining({ accountUserId: 'account-1', deviceId: 'device-1' })
    );
  });

  it('does not persist or reconnect a registration that finishes after revoke', async () => {
    const pending = deferred<{
      device: { id: string; name: string; created_at: string };
      registrationId: string;
      hostToken: string;
      pairingCode: string;
      pairingExpiresAt: string;
      relayBaseUrl: string;
    }>();
    mocks.registerRelayDevice.mockImplementation(() => pending.promise);
    const service = new MobileRelayService();

    const enable = service.enable('Test Desktop');
    const enableResult = expect(enable).rejects.toThrow('Relay operation was cancelled');
    await vi.waitFor(() => expect(mocks.registerRelayDevice).toHaveBeenCalledTimes(1));

    const revoke = service.revoke();
    pending.resolve({
      device: { id: 'device-1', name: 'Test Desktop', created_at: '2026-07-12T00:00:00Z' },
      registrationId: '11111111-1111-4111-8111-111111111111',
      hostToken: `yrh_${'a'.repeat(43)}`,
      pairingCode: `yrp_${'b'.repeat(43)}`,
      pairingExpiresAt: '2026-07-12T00:10:00Z',
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    });

    await enableResult;
    await revoke;
    expect(mocks.credentialSet).not.toHaveBeenCalled();
    expect(mocks.credentialClear).toHaveBeenCalled();
    expect(mocks.confirmRelayDeviceRegistration).not.toHaveBeenCalled();
    expect(mocks.webSocketConstructor).not.toHaveBeenCalled();
    expect(service.getStatus().configured).toBe(false);
  });

  it('attempts remote revocation even when local credential cleanup fails', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    mocks.credentialRevoke.mockRejectedValueOnce(new Error('Keychain unavailable'));
    const service = new MobileRelayService();
    await service.initialize();

    await expect(service.revoke()).rejects.toThrow('Failed to fully revoke Yoda Relay');

    expect(mocks.credentialRevoke).toHaveBeenCalledWith(storedCredentials);
    expect(mocks.revokeRelayDevice).toHaveBeenCalledWith('device-1', undefined, false);
    expect(service.getStatus().configured).toBe(false);
  });

  it('persists the revocation outbox before remotely deleting and confirming a device', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    const localRevocation = deferred<void>();
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    mocks.credentialRevoke.mockImplementationOnce(() => localRevocation.promise);
    const service = new MobileRelayService();
    await service.initialize();

    const revoke = service.revoke();
    await vi.waitFor(() => expect(mocks.credentialRevoke).toHaveBeenCalledTimes(1));
    expect(mocks.revokeRelayDevice).not.toHaveBeenCalled();
    localRevocation.resolve(undefined);
    await revoke;

    expect(mocks.revokeRelayDevice).toHaveBeenCalledWith('device-1', undefined, false);
    expect(mocks.confirmRevocation).toHaveBeenCalledWith('account-1', 'device-1');
  });

  it('retries a durable pending revocation after the first remote delete fails', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    mocks.revokeRelayDevice.mockRejectedValueOnce(new Error('Relay timeout'));
    const service = new MobileRelayService();
    await service.initialize();

    await expect(service.revoke()).rejects.toThrow('Failed to fully revoke Yoda Relay');
    expect(mocks.confirmRevocation).not.toHaveBeenCalled();

    mocks.credentialGet.mockResolvedValue(null);
    mocks.getPendingRevocations.mockResolvedValue([
      { accountUserId: 'account-1', deviceId: 'device-1' },
    ]);
    await service.revoke();

    expect(mocks.revokeRelayDevice).toHaveBeenCalledTimes(2);
    expect(mocks.confirmRevocation).toHaveBeenCalledWith('account-1', 'device-1');
  });

  it('tombstones credentials that belong to a different signed-in account', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.session = {
      isSignedIn: true,
      hasAccount: true,
      user: { userId: 'account-2' },
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    mocks.credentialRevoke.mockRejectedValueOnce(new Error('Keychain unavailable'));
    const service = new MobileRelayService();

    await expect(service.initialize()).rejects.toThrow('Keychain unavailable');

    expect(mocks.credentialRevoke).toHaveBeenCalledWith(storedCredentials);
    expect(mocks.credentialClear).not.toHaveBeenCalled();
    expect(mocks.webSocketConstructor).not.toHaveBeenCalled();
  });

  it('migrates persisted Relay credentials to the official stable domain', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://legacy-relay.example.com',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();

    await service.initialize();

    const migratedCredentials = {
      ...storedCredentials,
      relayBaseUrl: MOBILE_RELAY_BASE_URL,
    };
    expect(mocks.credentialSet).toHaveBeenCalledWith(migratedCredentials);
    expect(mocks.webSocketConstructor).toHaveBeenCalledWith(
      'wss://relay.yoda.lovstudio.ai/v1/host/device-1',
      { headers: { Authorization: `Bearer ${storedCredentials.hostToken}` } }
    );
    expect(service.getStatus().relayBaseUrl).toBe(MOBILE_RELAY_BASE_URL);
  });

  it('revokes persisted credentials when sign-out overtakes initialization', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    const persistedRead = deferred<typeof storedCredentials>();
    mocks.credentialGet
      .mockImplementationOnce(() => persistedRead.promise)
      .mockResolvedValueOnce(storedCredentials);
    const service = new MobileRelayService();

    const initialize = service.initialize();
    await vi.waitFor(() => expect(mocks.credentialGet).toHaveBeenCalledTimes(1));
    const revoke = service.revoke(undefined, true);
    persistedRead.resolve(storedCredentials);

    await initialize;
    await revoke;
    expect(mocks.credentialGet).toHaveBeenCalledTimes(2);
    expect(mocks.credentialRevoke).toHaveBeenCalledWith(storedCredentials);
    expect(mocks.revokeRelayDevice).toHaveBeenCalledWith('device-1', undefined, true);
    expect(service.getStatus().configured).toBe(false);
  });

  it('keeps valid credentials but stops reconnecting when another host replaces it', async () => {
    vi.useFakeTimers();
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();
    await service.initialize();
    mocks.sockets[0]?.emitTest('close', 1006);
    await service.enable();
    expect(mocks.sockets).toHaveLength(2);

    mocks.sockets[1]?.emitTest('close', MOBILE_RELAY_HOST_CLOSE_CODE.replaced);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.credentialTombstone).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      configured: true,
      connected: false,
      lastError: 'Yoda Relay was connected by another Yoda instance',
    });
    expect(mocks.sockets).toHaveLength(2);

    await service.enable();

    expect(mocks.sockets).toHaveLength(3);
    expect(service.getStatus()).toMatchObject({
      configured: true,
      connecting: true,
      lastError: null,
    });
  });

  it('tombstones a credential rejected after WebSocket connection', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();
    await service.initialize();

    mocks.sockets[0]?.emitTest('close', MOBILE_RELAY_HOST_CLOSE_CODE.credentialRejected);

    await vi.waitFor(() =>
      expect(mocks.credentialTombstone).toHaveBeenCalledWith(storedCredentials)
    );
    expect(service.getStatus().configured).toBe(false);
  });

  it('tombstones an already-revoked credential rejected during WebSocket upgrade', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();
    await service.initialize();
    const response = { statusCode: 401, resume: vi.fn() };

    mocks.sockets[0]?.emitTest('unexpected-response', {}, response);

    await vi.waitFor(() =>
      expect(mocks.credentialTombstone).toHaveBeenCalledWith(storedCredentials)
    );
    expect(response.resume).toHaveBeenCalled();
    expect(mocks.sockets[0]?.terminate).toHaveBeenCalled();
    expect(service.getStatus().configured).toBe(false);
    expect(mocks.sockets).toHaveLength(1);
  });

  it('reconnects after a transient upgrade failure without deleting credentials', async () => {
    vi.useFakeTimers();
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();
    await service.initialize();

    mocks.sockets[0]?.emitTest('unexpected-response', {}, { statusCode: 503, resume: vi.fn() });
    mocks.sockets[0]?.emitTest('close', 1006);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.credentialTombstone).not.toHaveBeenCalled();
    expect(service.getStatus().configured).toBe(true);
    expect(mocks.sockets).toHaveLength(2);
  });

  it('preserves credentials and stops reconnecting when the Relay Pass is inactive', async () => {
    const storedCredentials = {
      accountUserId: 'account-1',
      deviceId: 'device-1',
      deviceName: 'Desktop',
      hostToken: `yrh_${'a'.repeat(43)}`,
      relayBaseUrl: 'https://relay.yoda.lovstudio.ai',
    };
    mocks.credentialGet.mockResolvedValue(storedCredentials);
    const service = new MobileRelayService();
    await service.initialize();

    mocks.sockets[0]?.emitTest('unexpected-response', {}, { statusCode: 402, resume: vi.fn() });

    expect(mocks.credentialTombstone).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      configured: true,
      lastError: 'Yoda Relay Pass is not active',
    });
    expect(mocks.sockets).toHaveLength(1);
  });
});
