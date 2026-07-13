import { hostname } from 'node:os';
import WebSocket from 'ws';
import {
  createMobileRelayPairingUrl,
  MOBILE_RELAY_BASE_URL,
  MOBILE_RELAY_HOST_CLOSE_CODE,
  parseMobileRelayHostFrame,
  relayWebSocketUrl,
  type MobileRelayStatus,
} from '@shared/mobile-relay';
import { yodaAccountService } from '@main/core/account/services/yoda-account-service';
import { yodaCommerceService } from '@main/core/account/services/yoda-commerce-service';
import { log } from '@main/lib/logger';
import { mobileGatewayService } from './mobile-gateway-service';
import {
  mobileRelayCredentialStore,
  type MobileRelayCredentials,
} from './mobile-relay-credential-store';
import { MobileRelayRequestBridge } from './mobile-relay-request-bridge';

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class MobileRelayService {
  private socket: WebSocket | null = null;
  private credentials: MobileRelayCredentials | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private shouldReconnect = false;
  private connecting = false;
  private connected = false;
  private pairingUrl: string | null = null;
  private pairingExpiresAt: string | null = null;
  private lastError: string | null = null;
  private lifecycleGeneration = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private activeOperationAbort: AbortController | null = null;
  private initializeOperation: { generation: number; promise: Promise<void> } | null = null;
  private enableOperation: {
    generation: number;
    promise: Promise<MobileRelayStatus>;
  } | null = null;
  private pairingOperation: {
    generation: number;
    promise: Promise<MobileRelayStatus>;
  } | null = null;
  private readonly bridge = new MobileRelayRequestBridge(() =>
    mobileGatewayService.getRelayLoopbackConnection()
  );

  async initialize(): Promise<void> {
    if (this.initializeOperation?.generation === this.lifecycleGeneration) {
      return this.initializeOperation.promise;
    }
    const generation = ++this.lifecycleGeneration;
    const promise = this.enqueueOperation(() => this.initializeInternal(generation)).finally(() => {
      if (this.initializeOperation?.generation === generation) {
        this.initializeOperation = null;
      }
    });
    this.initializeOperation = { generation, promise };
    return promise;
  }

  private async initializeInternal(generation: number): Promise<void> {
    let credentials = await mobileRelayCredentialStore.get();
    if (!this.isCurrent(generation)) return;
    const session = await yodaAccountService.getSession();
    if (!this.isCurrent(generation)) return;
    if (session.isSignedIn && session.user) {
      try {
        await this.retryPendingRevocations(session.user.userId);
      } catch (error) {
        // The durable outbox remains intact and will retry on the next account
        // initialization, enable, manual revoke, or sign-out.
        log.warn('MobileRelay: pending device revocation retry failed', error);
      }
    }
    if (!this.isCurrent(generation)) return;
    if (
      credentials &&
      (!session.isSignedIn || credentials.accountUserId !== session.user?.userId)
    ) {
      this.disconnectSocket();
      this.credentials = null;
      await mobileRelayCredentialStore.revoke(credentials);
      credentials = null;
    }
    if (!this.isCurrent(generation)) return;
    if (credentials && credentials.relayBaseUrl !== MOBILE_RELAY_BASE_URL) {
      credentials = { ...credentials, relayBaseUrl: MOBILE_RELAY_BASE_URL };
      await mobileRelayCredentialStore.set(credentials);
    }
    if (!this.isCurrent(generation)) return;
    this.credentials = credentials;
    if (credentials) this.connect();
  }

  async enable(deviceName = hostname() || 'Yoda Desktop'): Promise<MobileRelayStatus> {
    if (this.enableOperation?.generation === this.lifecycleGeneration) {
      return this.enableOperation.promise;
    }
    const generation = ++this.lifecycleGeneration;
    const promise = this.enqueueOperation(() =>
      this.enableInternal(deviceName, generation)
    ).finally(() => {
      if (this.enableOperation?.generation === generation) this.enableOperation = null;
    });
    this.enableOperation = { generation, promise };
    return promise;
  }

  private async enableInternal(deviceName: string, generation: number): Promise<MobileRelayStatus> {
    this.assertCurrent(generation);
    if (!mobileGatewayService.getRelayLoopbackConnection()) {
      throw new Error('The Yoda mobile gateway must be running before enabling Relay');
    }
    const controller = this.startAbortableOperation(generation);
    try {
      if (!this.credentials) {
        const session = await yodaAccountService.getSession();
        if (!session.isSignedIn || !session.user) {
          throw new Error('Sign in to your LovStudio account before enabling Yoda Relay');
        }
        const accountUserId = session.user.userId;
        await this.retryPendingRevocations(accountUserId, controller.signal);
        this.assertCurrent(generation);
        const registration = await yodaCommerceService.registerRelayDevice(
          deviceName,
          controller.signal
        );
        await this.assertCurrentAccount(generation, accountUserId);
        const credentials: MobileRelayCredentials = {
          accountUserId: session.user.userId,
          deviceId: registration.device.id,
          deviceName: registration.device.name,
          hostToken: registration.hostToken,
          relayBaseUrl: MOBILE_RELAY_BASE_URL,
        };
        await mobileRelayCredentialStore.set(credentials);
        this.assertCurrent(generation);
        this.credentials = credentials;
        await yodaCommerceService.confirmRelayDeviceRegistration(
          accountUserId,
          registration.registrationId
        );
        await this.assertCurrentAccount(generation, accountUserId);
        this.setPairing(
          registration.pairingCode,
          registration.pairingExpiresAt,
          MOBILE_RELAY_BASE_URL,
          registration.device.id
        );
      } else {
        await this.assertCurrentAccount(generation, this.credentials.accountUserId);
      }
      this.assertCurrent(generation);
      this.connect();
      return this.getStatus();
    } finally {
      this.finishAbortableOperation(controller);
    }
  }

  async createPairing(): Promise<MobileRelayStatus> {
    if (!this.credentials) await this.enable();
    const generation = this.lifecycleGeneration;
    if (this.pairingOperation?.generation === generation) {
      return this.pairingOperation.promise;
    }
    const promise = this.enqueueOperation(() => this.createPairingInternal(generation)).finally(
      () => {
        if (this.pairingOperation?.generation === generation) this.pairingOperation = null;
      }
    );
    this.pairingOperation = { generation, promise };
    return promise;
  }

  private async createPairingInternal(generation: number): Promise<MobileRelayStatus> {
    this.assertCurrent(generation);
    if (!this.credentials) throw new Error('Relay device is unavailable');
    const credentials = this.credentials;
    const controller = this.startAbortableOperation(generation);
    try {
      const pairing = await yodaCommerceService.createRelayPairing(
        credentials.deviceId,
        controller.signal
      );
      await this.assertCurrentAccount(generation, credentials.accountUserId);
      if (this.credentials?.deviceId !== credentials.deviceId) {
        throw new Error('Relay operation was cancelled');
      }
      this.setPairing(
        pairing.pairingCode,
        pairing.pairingExpiresAt,
        credentials.relayBaseUrl,
        credentials.deviceId
      );
      return this.getStatus();
    } finally {
      this.finishAbortableOperation(controller);
    }
  }

  async revoke(signal?: AbortSignal, allowDuringSignOut = false): Promise<void> {
    ++this.lifecycleGeneration;
    this.activeOperationAbort?.abort();
    this.disconnectSocket();
    await this.enqueueOperation(() => this.revokeInternal(signal, allowDuringSignOut));
  }

  private async revokeInternal(signal?: AbortSignal, allowDuringSignOut = false): Promise<void> {
    // initialize() may have read persisted credentials before revoke() advanced
    // the generation, then intentionally declined to publish them in memory.
    // Re-read inside the serialized revoke operation so that sign-out still
    // tombstones and remotely revokes that device.
    const credentials = this.credentials ?? (await mobileRelayCredentialStore.get());
    const pending = await mobileRelayCredentialStore.getPendingRevocations();
    this.credentials = null;
    this.pairingUrl = null;
    this.pairingExpiresAt = null;
    const targets = new Map<string, { accountUserId: string; deviceId: string }>();
    for (const item of pending) targets.set(`${item.accountUserId}:${item.deviceId}`, item);
    if (credentials) {
      targets.set(`${credentials.accountUserId}:${credentials.deviceId}`, credentials);
    }
    const localOperation = credentials
      ? mobileRelayCredentialStore.revoke(credentials)
      : targets.size === 0
        ? mobileRelayCredentialStore.clear()
        : Promise.resolve();
    const localSettled = localOperation.catch(() => undefined);
    const operations: Promise<unknown>[] = [localOperation];
    let remoteChain = localSettled;
    for (const target of targets.values()) {
      const remoteOperation = remoteChain
        .then(() =>
          yodaCommerceService.revokeRelayDevice(target.deviceId, signal, allowDuringSignOut)
        )
        .then(() =>
          mobileRelayCredentialStore.confirmRevocation(target.accountUserId, target.deviceId)
        );
      operations.push(remoteOperation);
      remoteChain = remoteOperation.catch(() => undefined);
    }
    const results = await Promise.allSettled(operations);
    const failures = results.filter((result) => result.status === 'rejected');
    for (const failure of failures) {
      log.warn('MobileRelay: device revocation step failed', failure.reason);
    }
    if (failures.length > 0) {
      throw new Error(`Failed to fully revoke Yoda Relay (${failures.length} step(s))`);
    }
  }

  private async retryPendingRevocations(
    accountUserId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const pending = (await mobileRelayCredentialStore.getPendingRevocations()).filter(
      (item) => item.accountUserId === accountUserId
    );
    for (const item of pending) {
      await yodaCommerceService.revokeRelayDevice(item.deviceId, signal);
      await mobileRelayCredentialStore.confirmRevocation(item.accountUserId, item.deviceId);
    }
  }

  async revokeDevice(deviceId: string): Promise<void> {
    if (this.credentials?.deviceId === deviceId) {
      await this.revoke();
      return;
    }
    await yodaCommerceService.revokeRelayDevice(deviceId);
  }

  disconnect(): void {
    ++this.lifecycleGeneration;
    this.activeOperationAbort?.abort();
    this.disconnectSocket();
  }

  private disconnectSocket(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.bridge.cancelAll();
    const socket = this.socket;
    this.socket = null;
    this.connecting = false;
    this.connected = false;
    socket?.close(1000, 'desktop disconnect');
  }

  dispose(): void {
    this.disconnect();
  }

  getStatus(): MobileRelayStatus {
    return {
      configured: Boolean(this.credentials),
      connected: this.connected,
      connecting: this.connecting,
      deviceId: this.credentials?.deviceId ?? null,
      deviceName: this.credentials?.deviceName ?? null,
      relayBaseUrl: this.credentials?.relayBaseUrl ?? null,
      pairingUrl:
        this.pairingExpiresAt && Date.parse(this.pairingExpiresAt) > Date.now()
          ? this.pairingUrl
          : null,
      pairingExpiresAt: this.pairingExpiresAt,
      lastError: this.lastError,
    };
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.lifecycleGeneration;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new Error('Relay operation was cancelled');
  }

  private async assertCurrentAccount(generation: number, accountUserId: string): Promise<void> {
    this.assertCurrent(generation);
    const session = await yodaAccountService.getSession();
    this.assertCurrent(generation);
    if (!session.isSignedIn || session.user?.userId !== accountUserId) {
      throw new Error('Relay operation was cancelled because the LovStudio account changed');
    }
  }

  private startAbortableOperation(generation: number): AbortController {
    this.assertCurrent(generation);
    const controller = new AbortController();
    this.activeOperationAbort = controller;
    return controller;
  }

  private finishAbortableOperation(controller: AbortController): void {
    if (this.activeOperationAbort === controller) this.activeOperationAbort = null;
  }

  private connect(): void {
    if (!this.credentials || this.socket || this.connecting) return;
    this.shouldReconnect = true;
    this.connecting = true;
    this.lastError = null;
    const credentials = this.credentials;
    const socket = new WebSocket(
      relayWebSocketUrl(credentials.relayBaseUrl, credentials.deviceId),
      {
        headers: { Authorization: `Bearer ${credentials.hostToken}` },
      }
    );
    this.socket = socket;

    socket.on('open', () => {
      if (this.socket !== socket) return;
      this.connecting = false;
      this.connected = true;
      this.reconnectDelay = RECONNECT_MIN_MS;
      log.info('MobileRelay: connected', { deviceId: credentials.deviceId });
    });
    socket.on('message', (data) => {
      if (this.socket !== socket) return;
      try {
        const frame = parseMobileRelayHostFrame(JSON.parse(data.toString()));
        if (!frame) {
          socket.close(1008, 'Invalid Relay frame');
          return;
        }
        this.bridge.handle(socket, frame);
      } catch (error) {
        log.warn('MobileRelay: ignored invalid frame', { error: String(error) });
      }
    });
    socket.on('error', (error) => {
      if (this.socket !== socket) return;
      this.lastError = error.message;
      log.warn('MobileRelay: socket error', { error: error.message });
    });
    socket.on('unexpected-response', (_request, response) => {
      if (this.socket !== socket) return;
      const status = response.statusCode ?? 0;
      response.resume();
      if ([401, 403, 404].includes(status)) {
        this.socket = null;
        this.connecting = false;
        this.connected = false;
        this.bridge.cancelAll();
        this.invalidateCredentials(credentials, 'Yoda Relay credential was rejected');
        socket.terminate();
        return;
      }
      if (status === 402) {
        this.socket = null;
        this.connecting = false;
        this.connected = false;
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.lastError = 'Yoda Relay Pass is not active';
        this.bridge.cancelAll();
        socket.terminate();
        return;
      }
      socket.terminate();
    });
    socket.on('close', (code) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connecting = false;
      this.connected = false;
      this.bridge.cancelAll();
      if (
        code === MOBILE_RELAY_HOST_CLOSE_CODE.credentialRejected ||
        code === MOBILE_RELAY_HOST_CLOSE_CODE.credentialForbidden
      ) {
        this.invalidateCredentials(credentials, 'Yoda Relay credential was rejected');
      }
      if (code === MOBILE_RELAY_HOST_CLOSE_CODE.passInactive) {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.lastError = 'Yoda Relay Pass is not active';
      }
      if (code === MOBILE_RELAY_HOST_CLOSE_CODE.replaced) {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.lastError = 'Yoda Relay was connected by another Yoda instance';
      }
      if (this.shouldReconnect) this.scheduleReconnect();
    });
  }

  private invalidateCredentials(credentials: MobileRelayCredentials, message: string): void {
    ++this.lifecycleGeneration;
    this.activeOperationAbort?.abort();
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.credentials = null;
    this.pairingUrl = null;
    this.pairingExpiresAt = null;
    this.lastError = message;
    void this.enqueueOperation(() => mobileRelayCredentialStore.tombstone(credentials)).catch(
      (error) => {
        log.warn('MobileRelay: failed to tombstone rejected credentials', error);
      }
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setPairing(
    pairingCode: string,
    expiresAt: string,
    relayBaseUrl: string,
    deviceId: string
  ): void {
    this.pairingUrl = createMobileRelayPairingUrl({ deviceId, pairingCode, relayBaseUrl });
    this.pairingExpiresAt = expiresAt;
  }
}

export const mobileRelayService = new MobileRelayService();
