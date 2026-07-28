import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { YodaExtensionRuntimeStatus } from '@shared/extensions';
import { log } from '@main/lib/logger';
import type { BackgroundServiceRuntime } from '../background-service-runtime';
import {
  isMaasGatewayWorkerMessage,
  type MaasGatewayHostMessage,
  type MaasGatewayProviderConfiguration,
  type MaasGatewayWorkerMessage,
} from './protocol';

const START_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 3_000;
const RESTART_DELAY_MS = 1_000;

type GatewayRollback = () => Promise<void>;

type ForkUtilityProcess = (
  modulePath: string,
  args: string[],
  options: {
    serviceName: string;
    stdio: 'pipe';
  }
) => UtilityProcess;

type PendingRequest = {
  resolve: (message: MaasGatewayWorkerMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class MaasGatewayExtensionRuntime implements BackgroundServiceRuntime {
  private child: UtilityProcess | null = null;
  private configuration: MaasGatewayProviderConfiguration | null = null;
  private admissionToken = '';
  private desiredRunning = false;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<YodaExtensionRuntimeStatus> | null = null;
  private startResolve: ((status: YodaExtensionRuntimeStatus) => void) | null = null;
  private startReject: ((error: Error) => void) | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private status: YodaExtensionRuntimeStatus = stoppedStatus();

  constructor(
    private readonly forkUtilityProcess: ForkUtilityProcess = (modulePath, args, options) =>
      utilityProcess.fork(modulePath, args, options),
    private readonly workerPath = fileURLToPath(
      new URL('./extension-workers/maas-gateway.js', import.meta.url)
    )
  ) {}

  getStatus(): YodaExtensionRuntimeStatus {
    return structuredClone(this.status);
  }

  getConnection(): { baseUrl: string; admissionToken: string } | null {
    if (this.status.state !== 'running' || !this.status.endpoint || !this.admissionToken) {
      return null;
    }
    return { baseUrl: this.status.endpoint, admissionToken: this.admissionToken };
  }

  async start(): Promise<YodaExtensionRuntimeStatus> {
    this.desiredRunning = true;
    if (this.status.state === 'running') return this.getStatus();
    if (this.startPromise) return this.startPromise;

    this.clearRestartTimer();
    this.stopping = false;
    // Keep the local token stable across supervised crash restarts so existing
    // Codex processes continue authenticating. Explicit stop/start creates a
    // new token and the owning MaaS service rewrites Codex config.
    if (!this.admissionToken) {
      this.admissionToken = randomBytes(32).toString('base64url');
    }
    this.status = {
      state: 'starting',
      pid: null,
      port: null,
      endpoint: null,
      configuredProviderId: this.configuration?.providerId ?? null,
      error: null,
      updatedAt: new Date().toISOString(),
    };

    const child = this.forkUtilityProcess(this.workerPath, [], {
      serviceName: 'Yoda MaaS Gateway',
      stdio: 'pipe',
    });
    this.child = child;
    this.attachChild(child);

    this.startPromise = new Promise<YodaExtensionRuntimeStatus>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.startTimeout = setTimeout(() => {
        this.failStart(new Error('MaaS Gateway did not start within 10 seconds.'));
        child.kill();
      }, START_TIMEOUT_MS);
    });

    child.once('spawn', () => {
      if (this.child !== child) return;
      this.status = { ...this.status, pid: child.pid ?? null, updatedAt: new Date().toISOString() };
      this.postMessage({
        type: 'start',
        admissionToken: this.admissionToken,
        port: 0,
      });
    });

    return this.startPromise;
  }

  async configure(configuration: MaasGatewayProviderConfiguration): Promise<GatewayRollback> {
    const normalized = normalizeConfiguration(configuration);
    const previous = this.configuration ? { ...this.configuration } : null;
    await this.start();
    await this.sendConfiguration(normalized);
    this.configuration = normalized;
    this.status = {
      ...this.status,
      configuredProviderId: normalized.providerId,
      error: null,
      updatedAt: new Date().toISOString(),
    };

    return async () => {
      if (previous) {
        await this.sendConfiguration(previous);
      } else {
        await this.sendClear();
      }
      this.configuration = previous;
      this.status = {
        ...this.status,
        configuredProviderId: previous?.providerId ?? null,
        updatedAt: new Date().toISOString(),
      };
    };
  }

  async clear(): Promise<void> {
    this.configuration = null;
    if (this.status.state === 'running') {
      await this.sendClear();
    }
    this.status = {
      ...this.status,
      configuredProviderId: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.stopping = true;
    this.clearRestartTimer();
    const child = this.child;
    if (!child) {
      this.admissionToken = '';
      this.status = stoppedStatus();
      this.stopping = false;
      return;
    }

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    let stopTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      this.postMessage({ type: 'shutdown' });
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          stopTimeout = setTimeout(() => {
            child.kill();
            resolve();
          }, STOP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (stopTimeout) clearTimeout(stopTimeout);
    }
    this.child = null;
    this.rejectPending(new Error('MaaS Gateway stopped.'));
    this.admissionToken = '';
    this.status = stoppedStatus();
    this.stopping = false;
  }

  private attachChild(child: UtilityProcess): void {
    child.on('message', (value) => {
      if (this.child !== child || !isMaasGatewayWorkerMessage(value)) return;
      this.handleWorkerMessage(value);
    });
    child.on('error', (_type, _location, report) => {
      if (this.child !== child) return;
      this.handleChildFailure(new Error(report || 'MaaS Gateway utility process failed.'));
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping || !this.desiredRunning) {
        this.status = stoppedStatus();
        return;
      }
      this.handleChildFailure(new Error(`MaaS Gateway exited with code ${code}.`));
      this.scheduleRestart();
    });
  }

  private handleWorkerMessage(message: MaasGatewayWorkerMessage): void {
    if (message.type === 'ready') {
      this.clearStartTimeout();
      this.status = {
        state: 'running',
        pid: this.child?.pid ?? null,
        port: message.port,
        endpoint: `http://127.0.0.1:${message.port}/v1`,
        configuredProviderId: this.configuration?.providerId ?? null,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      const resolve = this.startResolve;
      this.resetStartPromise();
      resolve?.(this.getStatus());
      if (this.configuration) {
        void this.sendConfiguration(this.configuration).catch((error) => {
          this.handleChildFailure(error);
        });
      }
      return;
    }

    if (message.type === 'configured' || message.type === 'error') {
      const requestId = message.requestId;
      if (!requestId) {
        if (message.type === 'error') this.handleChildFailure(new Error(message.message));
        return;
      }
      const pending = this.pendingRequests.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      if (message.type === 'error') pending.reject(new Error(message.message));
      else pending.resolve(message);
    }
  }

  private sendConfiguration(configuration: MaasGatewayProviderConfiguration): Promise<void> {
    return this.sendRequest({
      type: 'configure',
      requestId: randomUUID(),
      configuration,
    });
  }

  private sendClear(): Promise<void> {
    return this.sendRequest({ type: 'clear', requestId: randomUUID() });
  }

  private sendRequest(
    message: Extract<MaasGatewayHostMessage, { type: 'configure' | 'clear' }>
  ): Promise<void> {
    if (!this.child || this.status.state !== 'running') {
      return Promise.reject(new Error('MaaS Gateway is not running.'));
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.requestId);
        reject(new Error('MaaS Gateway did not acknowledge the configuration update.'));
      }, REQUEST_TIMEOUT_MS);
      this.pendingRequests.set(message.requestId, {
        resolve: () => resolve(),
        reject,
        timeout,
      });
      this.postMessage(message);
    });
  }

  private postMessage(message: MaasGatewayHostMessage): void {
    this.child?.postMessage(message);
  }

  private handleChildFailure(error: Error): void {
    this.failStart(error);
    this.rejectPending(error);
    this.status = {
      state: 'error',
      pid: this.child?.pid ?? null,
      port: null,
      endpoint: null,
      configuredProviderId: this.configuration?.providerId ?? null,
      error: error.message,
      updatedAt: new Date().toISOString(),
    };
    log.error('Yoda MaaS Gateway failed', { error: error.message });
  }

  private failStart(error: Error): void {
    if (!this.startPromise) return;
    this.clearStartTimeout();
    const reject = this.startReject;
    this.resetStartPromise();
    reject?.(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private scheduleRestart(): void {
    if (!this.desiredRunning || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.start().catch((error) => {
        log.error('Failed to restart Yoda MaaS Gateway', { error: String(error) });
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearStartTimeout(): void {
    if (!this.startTimeout) return;
    clearTimeout(this.startTimeout);
    this.startTimeout = null;
  }

  private resetStartPromise(): void {
    this.startPromise = null;
    this.startResolve = null;
    this.startReject = null;
  }
}

function normalizeConfiguration(
  configuration: MaasGatewayProviderConfiguration
): MaasGatewayProviderConfiguration {
  const providerId = configuration.providerId.trim();
  const endpoint = configuration.endpoint.trim().replace(/\/+$/, '');
  const apiKey = configuration.apiKey.trim();
  if (!providerId || !endpoint || !apiKey) {
    throw new Error('MaaS Gateway requires a provider, endpoint, and API key.');
  }
  const parsedEndpoint = new URL(endpoint);
  if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
    throw new Error('MaaS Gateway endpoints must use HTTP or HTTPS.');
  }
  return { providerId, endpoint, apiKey };
}

function stoppedStatus(): YodaExtensionRuntimeStatus {
  return {
    state: 'stopped',
    pid: null,
    port: null,
    endpoint: null,
    configuredProviderId: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };
}

export const maasGatewayExtensionRuntime = new MaasGatewayExtensionRuntime();
