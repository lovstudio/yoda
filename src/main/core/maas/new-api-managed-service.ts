import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, clipboard, shell } from 'electron';
import {
  NEW_API_MANAGED_ADMIN_URL,
  NEW_API_MANAGED_ADMIN_USERNAME,
  NEW_API_MANAGED_ENDPOINT,
  type NewApiManagedActionResult,
  type NewApiManagedCredentialActionResult,
  type NewApiManagedOperation,
  type NewApiManagedStatus,
} from '@shared/new-api-managed';
import { log } from '@main/lib/logger';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import {
  createDockerCommandRunner,
  detectDocker,
  launchDockerDesktop,
  managedRuntimeDelay,
  managedRuntimeErrorMessage,
  type DockerAvailability,
  type DockerCommandResult,
  type DockerCommandRunner,
} from './docker-managed-runtime';
import { maasService } from './maas-service';

const NEW_API_IMAGE_VERSION = 'v1.0.0-rc.22';
const NEW_API_IMAGE = `calciumion/new-api:${NEW_API_IMAGE_VERSION}`;
const COMPOSE_PROJECT_NAME = 'yoda-new-api';
const COMPOSE_FILENAME = 'compose.yaml';
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const STATUS_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 2 * 60 * 1_000;
const DOCKER_START_GRACE_MS = 5 * 60 * 1_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
const SESSION_SECRET = 'yoda-new-api-session-secret';
const ADMIN_PASSWORD_SECRET = 'yoda-new-api-admin-password';
const API_KEY_SECRET = 'yoda-new-api-api-key';
const YODA_TOKEN_NAME = 'Yoda';

type SecretStore = Pick<typeof encryptedAppSecretsStore, 'getSecret' | 'setSecret'>;
type MaasConnector = Pick<typeof maasService, 'connectPlatform'>;

type NewApiManagedServiceOptions = {
  runDocker?: DockerCommandRunner;
  getManagedDirectory?: () => string;
  fetch?: typeof globalThis.fetch;
  secretStore?: SecretStore;
  maasConnector?: MaasConnector;
  writeClipboard?: (value: string) => void;
  openExternal?: (url: string) => Promise<void>;
  launchDockerDesktop?: () => Promise<void>;
  platform?: NodeJS.Platform;
};

type NewApiManagedOperationTarget = 'running' | 'stopped' | 'docker-running';

type ActiveOperation = {
  kind: NewApiManagedOperation;
  target: NewApiManagedOperationTarget;
  promise: Promise<NewApiManagedActionResult>;
};

type ManagedSecrets = {
  sessionSecret: string;
  adminPassword: string;
};

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type SetupResponse = {
  status?: boolean;
};

type LoginResponse = {
  access_token?: string;
};

type TokenSummary = {
  id?: number;
  name?: string;
};

type TokenPage = {
  items?: TokenSummary[];
};

type TokenKeyResponse = {
  key?: string;
};

type ModelsResponse = {
  data?: unknown[];
};

function composeFileContents(): string {
  return `# Managed by Yoda. Credentials are supplied from encrypted storage at runtime.
services:
  new-api:
    image: ${NEW_API_IMAGE}
    ports:
      - "127.0.0.1:4001:3000"
    environment:
      SESSION_SECRET: "\${NEW_API_SESSION_SECRET}"
      SESSION_COOKIE_SECURE: "false"
      TZ: "Asia/Shanghai"
    volumes:
      - new_api_data:/data
    restart: unless-stopped

volumes:
  new_api_data:
`;
}

export class NewApiManagedService {
  private readonly runDocker: DockerCommandRunner;
  private readonly getManagedDirectory: () => string;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly secretStore: SecretStore;
  private readonly maasConnector: MaasConnector;
  private readonly writeClipboard: (value: string) => void;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly launchDockerDesktop: () => Promise<void>;
  private readonly platform: NodeJS.Platform;
  private activeOperation: ActiveOperation | null = null;
  private dockerStartRequestedAt: number | null = null;

  constructor(options: NewApiManagedServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.runDocker = options.runDocker ?? createDockerCommandRunner(this.platform);
    this.getManagedDirectory =
      options.getManagedDirectory ?? (() => join(app.getPath('userData'), 'new-api'));
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.secretStore = options.secretStore ?? encryptedAppSecretsStore;
    this.maasConnector = options.maasConnector ?? maasService;
    this.writeClipboard = options.writeClipboard ?? ((value) => clipboard.writeText(value));
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.launchDockerDesktop =
      options.launchDockerDesktop ?? (() => launchDockerDesktop(this.platform, this.runDocker));
  }

  async getStatus(): Promise<NewApiManagedStatus> {
    const [docker, installed, setup, adminPassword] = await Promise.all([
      detectDocker(this.runDocker, STATUS_TIMEOUT_MS),
      this.fileExists(this.composePath()),
      this.probeSetup(),
      this.secretStore.getSecret(ADMIN_PASSWORD_SECRET),
    ]);

    if (docker.running) this.dockerStartRequestedAt = null;

    if (setup.reachable) {
      return this.createStatus({
        state: installed ? (setup.initialized ? 'running' : 'needs-setup') : 'external-running',
        installed,
        initialized: setup.initialized,
        credentialsAvailable: Boolean(adminPassword),
        docker,
        modelCount: installed && setup.initialized ? await this.getModelCount() : null,
      });
    }

    if (!docker.installed) {
      this.dockerStartRequestedAt = null;
      return this.createStatus({
        state: 'docker-missing',
        installed,
        initialized: false,
        credentialsAvailable: Boolean(adminPassword),
        docker,
        modelCount: null,
      });
    }

    if (!docker.running) {
      return this.createStatus({
        state: this.isDockerStarting() ? 'docker-starting' : 'docker-stopped',
        installed,
        initialized: false,
        credentialsAvailable: Boolean(adminPassword),
        docker,
        modelCount: null,
      });
    }

    return this.createStatus({
      state: installed ? 'stopped' : 'not-installed',
      installed,
      initialized: false,
      credentialsAvailable: Boolean(adminPassword),
      docker,
      modelCount: null,
    });
  }

  async install(): Promise<NewApiManagedActionResult> {
    return this.runExclusive('installing', 'running', async () => {
      const status = await this.getStatus();
      if (status.state === 'external-running') {
        return {
          success: false,
          status,
          error: 'Port 4001 already has an existing New API service.',
        };
      }
      if (
        status.state === 'docker-missing' ||
        status.state === 'docker-starting' ||
        status.state === 'docker-stopped'
      ) {
        return { success: false, status, error: 'Docker Desktop is not ready.' };
      }

      try {
        await this.ensureComposeFile();
        const secrets = await this.getOrCreateManagedSecrets();
        const env = this.composeEnvironment(secrets);
        await this.runCompose(['pull'], env, COMMAND_TIMEOUT_MS);
        await this.runCompose(['up', '-d', '--remove-orphans'], env, COMMAND_TIMEOUT_MS);
        await this.waitUntilReachable();
        await this.initializeAndConnect(secrets.adminPassword);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to install managed New API:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'New API installation failed.'),
        };
      }
    });
  }

  async initialize(): Promise<NewApiManagedActionResult> {
    return this.runExclusive('initializing', 'running', async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed New API is not installed.' };
      }
      if (status.state !== 'needs-setup' && status.state !== 'running') {
        return { success: false, status, error: 'New API is not ready for initialization.' };
      }

      try {
        const secrets = await this.getOrCreateManagedSecrets();
        await this.initializeAndConnect(secrets.adminPassword);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to initialize managed New API:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'New API initialization failed.'),
        };
      }
    });
  }

  async start(): Promise<NewApiManagedActionResult> {
    return this.runExclusive('starting', 'running', async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed New API is not installed.' };
      }
      if (
        status.state === 'docker-missing' ||
        status.state === 'docker-starting' ||
        status.state === 'docker-stopped'
      ) {
        return { success: false, status, error: 'Docker Desktop is not ready.' };
      }

      try {
        await this.ensureComposeFile();
        const secrets = await this.getOrCreateManagedSecrets();
        await this.runCompose(
          ['up', '-d', '--remove-orphans'],
          this.composeEnvironment(secrets),
          COMMAND_TIMEOUT_MS
        );
        await this.waitUntilReachable();
        await this.initializeAndConnect(secrets.adminPassword);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to start managed New API:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'New API startup failed.'),
        };
      }
    });
  }

  async stop(): Promise<NewApiManagedActionResult> {
    return this.runExclusive('stopping', 'stopped', async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed New API is not installed.' };
      }
      if (!status.dockerRunning) {
        return { success: false, status, error: 'Docker Desktop is not running.' };
      }

      try {
        const secrets = await this.getOrCreateManagedSecrets();
        await this.runCompose(
          ['stop'],
          this.composeEnvironment(secrets),
          Math.min(COMMAND_TIMEOUT_MS, 60_000)
        );
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to stop managed New API:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'New API shutdown failed.'),
        };
      }
    });
  }

  async startDockerDesktop(): Promise<NewApiManagedActionResult> {
    return this.runExclusive('starting-docker', 'docker-running', async () => {
      try {
        await this.launchDockerDesktop();
        this.dockerStartRequestedAt = Date.now();
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        this.dockerStartRequestedAt = null;
        log.error('Failed to start Docker Desktop for New API:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'Docker Desktop startup failed.'),
        };
      }
    });
  }

  async copyAdminPassword(): Promise<NewApiManagedCredentialActionResult> {
    try {
      await this.copyAdminPasswordToClipboard();
      return { success: true };
    } catch (error) {
      log.error('Failed to copy New API administrator password:', error);
      return {
        success: false,
        error: managedRuntimeErrorMessage(error, 'Failed to copy New API administrator password.'),
      };
    }
  }

  async openAdmin(): Promise<NewApiManagedCredentialActionResult> {
    try {
      const status = await this.getStatus();
      if (status.state !== 'running') {
        return { success: false, error: 'New API is not running.' };
      }
      await this.copyAdminPasswordToClipboard();
      await this.openExternal(NEW_API_MANAGED_ADMIN_URL);
      return { success: true };
    } catch (error) {
      log.error('Failed to open New API console:', error);
      return {
        success: false,
        error: managedRuntimeErrorMessage(error, 'Failed to open New API console.'),
      };
    }
  }

  private async initializeAndConnect(adminPassword: string): Promise<void> {
    const setup = await this.probeSetup();
    if (!setup.reachable) throw new Error('New API is not reachable.');

    if (!setup.initialized) {
      await this.requestApi<never>('/api/setup', {
        method: 'POST',
        body: JSON.stringify({
          username: NEW_API_MANAGED_ADMIN_USERNAME,
          password: adminPassword,
          confirmPassword: adminPassword,
          SelfUseModeEnabled: true,
          DemoSiteEnabled: false,
        }),
      });
    }

    const login = await this.requestApi<LoginResponse>('/api/user/login', {
      method: 'POST',
      body: JSON.stringify({
        username: NEW_API_MANAGED_ADMIN_USERNAME,
        password: adminPassword,
      }),
    });
    const accessToken = login.data?.access_token?.trim();
    if (!accessToken) throw new Error('New API did not return an administrator access token.');

    const apiKey = await this.getOrCreateApiKey(accessToken);
    const result = await this.maasConnector.connectPlatform({
      platformId: 'newapi',
      apiKey,
      displayName: 'New API',
      endpoint: NEW_API_MANAGED_ENDPOINT,
    });
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to connect Yoda to New API.');
    }
  }

  private async getOrCreateApiKey(accessToken: string): Promise<string> {
    const existing = await this.secretStore.getSecret(API_KEY_SECRET);
    if (existing && (await this.keyCanListModels(existing))) return existing;

    let token = await this.findYodaToken(accessToken);
    if (!token) {
      await this.requestApi<never>('/api/token/', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          name: YODA_TOKEN_NAME,
          remain_quota: 0,
          expired_time: -1,
          unlimited_quota: true,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
          group: 'default',
          cross_group_retry: false,
        }),
      });

      for (let attempt = 0; attempt < 5 && !token; attempt += 1) {
        token = await this.findYodaToken(accessToken);
        if (!token) await managedRuntimeDelay(100);
      }
    }

    if (!token?.id) throw new Error('New API did not return the Yoda token.');
    const keyResponse = await this.requestApi<TokenKeyResponse>(`/api/token/${token.id}/key`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const rawKey = keyResponse.data?.key?.trim();
    if (!rawKey) throw new Error('New API did not return the Yoda token key.');
    const apiKey = rawKey.startsWith('sk-') ? rawKey : `sk-${rawKey}`;
    await this.secretStore.setSecret(API_KEY_SECRET, apiKey);
    return apiKey;
  }

  private async findYodaToken(accessToken: string): Promise<TokenSummary | null> {
    const response = await this.requestApi<TokenPage>(
      `/api/token/search?keyword=${encodeURIComponent(YODA_TOKEN_NAME)}&p=1&size=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data?.items?.find((token) => token.name === YODA_TOKEN_NAME) ?? null;
  }

  private async keyCanListModels(key: string): Promise<boolean> {
    try {
      const response = await this.fetchApi(`${NEW_API_MANAGED_ENDPOINT}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getModelCount(): Promise<number | null> {
    const apiKey = await this.secretStore.getSecret(API_KEY_SECRET);
    if (!apiKey) return null;

    try {
      const response = await this.fetchApi(`${NEW_API_MANAGED_ENDPOINT}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as ModelsResponse;
      return Array.isArray(body.data) ? body.data.length : null;
    } catch {
      return null;
    }
  }

  private async requestApi<T>(
    path: string,
    init: Omit<RequestInit, 'signal'> = {}
  ): Promise<ApiResponse<T>> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await this.fetchApi(`${NEW_API_MANAGED_ADMIN_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS * 2),
    });
    if (!response.ok) {
      throw new Error(`New API request ${path} returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as ApiResponse<T>;
    if (body.success === false) {
      throw new Error(body.message?.trim() || `New API request ${path} failed.`);
    }
    return body;
  }

  private async probeSetup(): Promise<{ reachable: boolean; initialized: boolean }> {
    try {
      const response = await this.fetchApi(`${NEW_API_MANAGED_ADMIN_URL}/api/setup`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) return { reachable: false, initialized: false };
      const body = (await response.json()) as ApiResponse<SetupResponse>;
      return {
        reachable: body.success !== false && Boolean(body.data),
        initialized: body.data?.status === true,
      };
    } catch {
      return { reachable: false, initialized: false };
    }
  }

  private async waitUntilReachable(): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if ((await this.probeSetup()).reachable) return;
      await managedRuntimeDelay(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error('New API startup timed out.');
  }

  private async copyAdminPasswordToClipboard(): Promise<void> {
    const password = await this.secretStore.getSecret(ADMIN_PASSWORD_SECRET);
    if (!password) throw new Error('New API administrator credential is missing.');
    this.writeClipboard(password);
  }

  private isDockerStarting(): boolean {
    if (this.dockerStartRequestedAt === null) return false;
    if (Date.now() - this.dockerStartRequestedAt <= DOCKER_START_GRACE_MS) return true;
    this.dockerStartRequestedAt = null;
    return false;
  }

  private async runExclusive(
    kind: NewApiManagedOperation,
    target: NewApiManagedOperationTarget,
    operation: () => Promise<NewApiManagedActionResult>
  ): Promise<NewApiManagedActionResult> {
    const activeOperation = this.activeOperation;
    if (activeOperation) {
      if (activeOperation.target === target) return activeOperation.promise;
      await activeOperation.promise.catch(() => undefined);
      return this.runExclusive(kind, target, operation);
    }

    const operationPromise = Promise.resolve().then(operation);
    const trackedPromise = operationPromise
      .finally(() => {
        if (this.activeOperation?.promise === trackedPromise) this.activeOperation = null;
      })
      .then(async (result) => ({ ...result, status: await this.getStatus() }));
    this.activeOperation = { kind, target, promise: trackedPromise };
    return trackedPromise;
  }

  private createStatus({
    state,
    installed,
    initialized,
    credentialsAvailable,
    docker,
    modelCount,
  }: {
    state: NewApiManagedStatus['state'];
    installed: boolean;
    initialized: boolean;
    credentialsAvailable: boolean;
    docker: DockerAvailability;
    modelCount: number | null;
  }): NewApiManagedStatus {
    return {
      state,
      operation: this.activeOperation?.kind ?? null,
      managed: installed,
      installed,
      initialized,
      credentialsAvailable,
      dockerInstalled: docker.installed,
      dockerRunning: docker.running,
      canStartDocker: this.platform === 'darwin',
      dockerVersion: docker.version,
      endpoint: NEW_API_MANAGED_ENDPOINT,
      adminUrl: NEW_API_MANAGED_ADMIN_URL,
      imageVersion: NEW_API_IMAGE_VERSION,
      modelCount,
    };
  }

  private async getOrCreateManagedSecrets(): Promise<ManagedSecrets> {
    return {
      sessionSecret: await this.getOrCreateSecret(SESSION_SECRET, () =>
        randomBytes(32).toString('hex')
      ),
      adminPassword: await this.getOrCreateSecret(ADMIN_PASSWORD_SECRET, () =>
        randomBytes(24).toString('base64url')
      ),
    };
  }

  private async getOrCreateSecret(key: string, create: () => string): Promise<string> {
    const existing = await this.secretStore.getSecret(key);
    if (existing) return existing;
    const value = create();
    await this.secretStore.setSecret(key, value);
    return value;
  }

  private composeEnvironment(secrets: ManagedSecrets): NodeJS.ProcessEnv {
    return {
      ...process.env,
      NEW_API_SESSION_SECRET: secrets.sessionSecret,
    };
  }

  private async runCompose(
    args: string[],
    env: NodeJS.ProcessEnv,
    timeout: number
  ): Promise<DockerCommandResult> {
    return this.runDocker(
      ['compose', '--project-name', COMPOSE_PROJECT_NAME, '--file', this.composePath(), ...args],
      { timeout, env }
    );
  }

  private async ensureComposeFile(): Promise<void> {
    const directory = this.getManagedDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(this.composePath(), composeFileContents(), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private composePath(): string {
    return join(this.getManagedDirectory(), COMPOSE_FILENAME);
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}

export const newApiManagedService = new NewApiManagedService();
