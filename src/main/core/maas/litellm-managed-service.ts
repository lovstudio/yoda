import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, clipboard, shell } from 'electron';
import {
  LITELLM_MANAGED_ADMIN_URL,
  LITELLM_MANAGED_ENDPOINT,
  type LiteLlmManagedActionResult,
  type LiteLlmManagedStatus,
} from '@shared/litellm-managed';
import { log } from '@main/lib/logger';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import { maasService } from './maas-service';

const execFileAsync = promisify(execFile);
const LITELLM_IMAGE_VERSION = 'v1.86.0';
const LITELLM_IMAGE = `ghcr.io/berriai/litellm-database:${LITELLM_IMAGE_VERSION}`;
const COMPOSE_PROJECT_NAME = 'yoda-litellm';
const COMPOSE_FILENAME = 'compose.yaml';
const COMMAND_TIMEOUT_MS = 10 * 60 * 1_000;
const STATUS_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 2 * 60 * 1_000;
const DOCKER_START_TIMEOUT_MS = 60_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;
const MASTER_KEY_SECRET = 'yoda-litellm-master-key';
const SALT_KEY_SECRET = 'yoda-litellm-salt-key';
const POSTGRES_PASSWORD_SECRET = 'yoda-litellm-postgres-password';
const VIRTUAL_KEY_SECRET = 'yoda-litellm-virtual-key';

type DockerCommandResult = {
  stdout: string;
  stderr: string;
};

export type DockerCommandRunner = (
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv }
) => Promise<DockerCommandResult>;

type SecretStore = Pick<
  typeof encryptedAppSecretsStore,
  'getSecret' | 'setSecret' | 'deleteSecret'
>;

type MaasConnector = Pick<typeof maasService, 'connectPlatform'>;

type LiteLlmManagedServiceOptions = {
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

type DockerAvailability = {
  installed: boolean;
  running: boolean;
  version: string | null;
};

type ManagedSecrets = {
  masterKey: string;
  saltKey: string;
  postgresPassword: string;
};

type VirtualKeyResponse = {
  key?: string;
};

type ModelsResponse = {
  data?: unknown[];
};

function dockerCommandCandidates(platform: NodeJS.Platform): string[] {
  const candidates = new Set<string>();
  if (process.env.DOCKER_BIN) candidates.add(process.env.DOCKER_BIN);
  candidates.add('docker');

  if (platform === 'darwin') {
    candidates.add('/Applications/Docker.app/Contents/Resources/bin/docker');
    candidates.add('/opt/homebrew/bin/docker');
    candidates.add('/usr/local/bin/docker');
  } else if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      candidates.add(join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
    }
  } else {
    candidates.add('/usr/bin/docker');
    candidates.add('/usr/local/bin/docker');
  }

  return [...candidates];
}

function createDockerCommandRunner(platform: NodeJS.Platform): DockerCommandRunner {
  let resolvedCommand: string | null = null;

  return async (args, options) => {
    const candidates = resolvedCommand ? [resolvedCommand] : dockerCommandCandidates(platform);
    let lastError: unknown;

    for (const command of candidates) {
      try {
        const result = await execFileAsync(command, args, {
          encoding: 'utf8',
          timeout: options.timeout,
          maxBuffer: 16 * 1024 * 1024,
          env: options.env ?? process.env,
        });
        resolvedCommand = command;
        return {
          stdout: String(result.stdout),
          stderr: String(result.stderr),
        };
      } catch (error) {
        lastError = error;
        if (!isCommandMissing(error)) throw error;
      }
    }

    throw lastError ?? Object.assign(new Error('Docker executable not found.'), { code: 'ENOENT' });
  };
}

async function defaultLaunchDockerDesktop(platform: NodeJS.Platform): Promise<void> {
  if (platform === 'darwin') {
    await execFileAsync('/usr/bin/open', ['-a', 'Docker'], {
      encoding: 'utf8',
      timeout: STATUS_TIMEOUT_MS,
    });
    return;
  }

  throw new Error('Open Docker Desktop, then retry detection.');
}

function composeFileContents(): string {
  return `# Managed by Yoda. Credentials are supplied from encrypted storage at runtime.
services:
  litellm:
    image: ${LITELLM_IMAGE}
    ports:
      - "127.0.0.1:4000:4000"
    environment:
      LITELLM_MASTER_KEY: "\${LITELLM_MASTER_KEY}"
      LITELLM_SALT_KEY: "\${LITELLM_SALT_KEY}"
      DATABASE_URL: "postgresql://litellm:\${LITELLM_POSTGRES_PASSWORD}@db:5432/litellm"
      STORE_MODEL_IN_DB: "True"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: "\${LITELLM_POSTGRES_PASSWORD}"
      POSTGRES_DB: litellm
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm"]
      interval: 5s
      timeout: 5s
      retries: 10
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
`;
}

function isCommandMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class LiteLlmManagedService {
  private readonly runDocker: DockerCommandRunner;
  private readonly getManagedDirectory: () => string;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly secretStore: SecretStore;
  private readonly maasConnector: MaasConnector;
  private readonly writeClipboard: (value: string) => void;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly launchDockerDesktop: () => Promise<void>;
  private readonly platform: NodeJS.Platform;
  private operationInProgress = false;

  constructor(options: LiteLlmManagedServiceOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.runDocker = options.runDocker ?? createDockerCommandRunner(this.platform);
    this.getManagedDirectory =
      options.getManagedDirectory ?? (() => join(app.getPath('userData'), 'litellm'));
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.secretStore = options.secretStore ?? encryptedAppSecretsStore;
    this.maasConnector = options.maasConnector ?? maasService;
    this.writeClipboard = options.writeClipboard ?? ((value) => clipboard.writeText(value));
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.launchDockerDesktop =
      options.launchDockerDesktop ?? (() => defaultLaunchDockerDesktop(this.platform));
  }

  async getStatus(): Promise<LiteLlmManagedStatus> {
    const [docker, installed, healthy] = await Promise.all([
      this.detectDocker(),
      this.fileExists(this.composePath()),
      this.probeReadiness(),
    ]);

    if (healthy) {
      return this.createStatus({
        state: installed ? 'running' : 'external-running',
        installed,
        docker,
        modelCount: installed ? await this.getModelCount() : null,
      });
    }

    if (!docker.installed) {
      return this.createStatus({
        state: 'docker-missing',
        installed,
        docker,
        modelCount: null,
      });
    }

    if (!docker.running) {
      return this.createStatus({
        state: 'docker-stopped',
        installed,
        docker,
        modelCount: null,
      });
    }

    return this.createStatus({
      state: installed ? 'stopped' : 'not-installed',
      installed,
      docker,
      modelCount: null,
    });
  }

  async install(): Promise<LiteLlmManagedActionResult> {
    return this.runExclusive(async () => {
      const status = await this.getStatus();
      if (status.state === 'external-running') {
        return {
          success: false,
          status,
          error: 'Port 4000 already has an existing LiteLLM service.',
        };
      }
      if (status.state === 'docker-missing' || status.state === 'docker-stopped') {
        return {
          success: false,
          status,
          error: 'Docker Desktop is not ready.',
        };
      }

      try {
        await this.ensureComposeFile();
        const secrets = await this.getOrCreateManagedSecrets();
        const env = this.composeEnvironment(secrets);
        await this.runCompose(['pull'], env, COMMAND_TIMEOUT_MS);
        await this.runCompose(['up', '-d', '--remove-orphans'], env, COMMAND_TIMEOUT_MS);
        await this.waitUntilReady();
        await this.connectYoda(secrets.masterKey);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to install managed LiteLLM:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: errorMessage(error, 'LiteLLM installation failed.'),
        };
      }
    });
  }

  async start(): Promise<LiteLlmManagedActionResult> {
    return this.runExclusive(async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed LiteLLM is not installed.' };
      }
      if (status.state === 'docker-missing' || status.state === 'docker-stopped') {
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
        await this.waitUntilReady();
        await this.connectYoda(secrets.masterKey);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to start managed LiteLLM:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: errorMessage(error, 'LiteLLM startup failed.'),
        };
      }
    });
  }

  async stop(): Promise<LiteLlmManagedActionResult> {
    return this.runExclusive(async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed LiteLLM is not installed.' };
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
        log.error('Failed to stop managed LiteLLM:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: errorMessage(error, 'LiteLLM shutdown failed.'),
        };
      }
    });
  }

  async startDockerDesktop(): Promise<LiteLlmManagedActionResult> {
    return this.runExclusive(async () => {
      try {
        await this.launchDockerDesktop();
        const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const docker = await this.detectDocker();
          if (docker.running) {
            return { success: true, status: await this.getStatus() };
          }
          await delay(HEALTH_POLL_INTERVAL_MS);
        }
        return {
          success: false,
          status: await this.getStatus(),
          error: 'Docker Desktop startup timed out.',
        };
      } catch (error) {
        log.error('Failed to start Docker Desktop:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: errorMessage(error, 'Docker Desktop startup failed.'),
        };
      }
    });
  }

  async openAdmin(): Promise<{ success: boolean; error?: string }> {
    try {
      const status = await this.getStatus();
      if (status.state !== 'running') {
        return { success: false, error: 'LiteLLM is not running.' };
      }
      const masterKey = await this.secretStore.getSecret(MASTER_KEY_SECRET);
      if (!masterKey) {
        return { success: false, error: 'LiteLLM administrator credential is missing.' };
      }
      this.writeClipboard(masterKey);
      await this.openExternal(LITELLM_MANAGED_ADMIN_URL);
      return { success: true };
    } catch (error) {
      log.error('Failed to open LiteLLM Admin UI:', error);
      return {
        success: false,
        error: errorMessage(error, 'Failed to open LiteLLM Admin UI.'),
      };
    }
  }

  private async runExclusive(
    operation: () => Promise<LiteLlmManagedActionResult>
  ): Promise<LiteLlmManagedActionResult> {
    if (this.operationInProgress) {
      return {
        success: false,
        status: await this.getStatus(),
        error: 'Another LiteLLM operation is already running.',
      };
    }

    this.operationInProgress = true;
    try {
      return await operation();
    } finally {
      this.operationInProgress = false;
    }
  }

  private createStatus({
    state,
    installed,
    docker,
    modelCount,
  }: {
    state: LiteLlmManagedStatus['state'];
    installed: boolean;
    docker: DockerAvailability;
    modelCount: number | null;
  }): LiteLlmManagedStatus {
    return {
      state,
      managed: installed,
      installed,
      dockerInstalled: docker.installed,
      dockerRunning: docker.running,
      canStartDocker: this.platform === 'darwin',
      dockerVersion: docker.version,
      endpoint: LITELLM_MANAGED_ENDPOINT,
      adminUrl: LITELLM_MANAGED_ADMIN_URL,
      imageVersion: LITELLM_IMAGE_VERSION,
      modelCount,
    };
  }

  private async detectDocker(): Promise<DockerAvailability> {
    let version: string | null = null;
    try {
      const result = await this.runDocker(['--version'], { timeout: STATUS_TIMEOUT_MS });
      version = result.stdout.trim() || null;
    } catch (error) {
      if (isCommandMissing(error)) {
        return { installed: false, running: false, version: null };
      }
      return { installed: false, running: false, version: null };
    }

    try {
      await this.runDocker(['info', '--format', '{{.ServerVersion}}'], {
        timeout: STATUS_TIMEOUT_MS,
      });
      return { installed: true, running: true, version };
    } catch {
      return { installed: true, running: false, version };
    }
  }

  private async probeReadiness(): Promise<boolean> {
    try {
      const response = await this.fetchApi('http://127.0.0.1:4000/health/readiness', {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { status?: string };
      return body.status === 'healthy';
    } catch {
      return false;
    }
  }

  private async getModelCount(): Promise<number | null> {
    const masterKey = await this.secretStore.getSecret(MASTER_KEY_SECRET);
    if (!masterKey) return null;

    try {
      const response = await this.fetchApi('http://127.0.0.1:4000/v1/models', {
        headers: { Authorization: `Bearer ${masterKey}` },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as ModelsResponse;
      return Array.isArray(body.data) ? body.data.length : null;
    } catch {
      return null;
    }
  }

  private async connectYoda(masterKey: string): Promise<void> {
    const virtualKey = await this.getOrCreateVirtualKey(masterKey);
    const result = await this.maasConnector.connectPlatform({
      platformId: 'litellm',
      apiKey: virtualKey,
      displayName: 'LiteLLM',
      endpoint: LITELLM_MANAGED_ENDPOINT,
    });
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to connect Yoda to LiteLLM.');
    }
  }

  private async getOrCreateVirtualKey(masterKey: string): Promise<string> {
    const existing = await this.secretStore.getSecret(VIRTUAL_KEY_SECRET);
    if (existing && (await this.keyCanListModels(existing))) return existing;

    const response = await this.fetchApi('http://127.0.0.1:4000/key/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        models: [],
        key_alias: 'Yoda',
        metadata: { managed_by: 'Yoda' },
      }),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS * 2),
    });
    if (!response.ok) {
      throw new Error(`LiteLLM virtual key creation returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as VirtualKeyResponse;
    const key = body.key?.trim();
    if (!key) throw new Error('LiteLLM did not return a virtual key.');
    await this.secretStore.setSecret(VIRTUAL_KEY_SECRET, key);
    return key;
  }

  private async keyCanListModels(key: string): Promise<boolean> {
    try {
      const response = await this.fetchApi('http://127.0.0.1:4000/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.probeReadiness()) return;
      await delay(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error('LiteLLM startup timed out.');
  }

  private async getOrCreateManagedSecrets(): Promise<ManagedSecrets> {
    return {
      masterKey: await this.getOrCreateSecret(
        MASTER_KEY_SECRET,
        () => `sk-${randomBytes(32).toString('hex')}`
      ),
      saltKey: await this.getOrCreateSecret(
        SALT_KEY_SECRET,
        () => `sk-${randomBytes(32).toString('hex')}`
      ),
      postgresPassword: await this.getOrCreateSecret(POSTGRES_PASSWORD_SECRET, () =>
        randomBytes(32).toString('hex')
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
      LITELLM_MASTER_KEY: secrets.masterKey,
      LITELLM_SALT_KEY: secrets.saltKey,
      LITELLM_POSTGRES_PASSWORD: secrets.postgresPassword,
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

export const liteLlmManagedService = new LiteLlmManagedService();
