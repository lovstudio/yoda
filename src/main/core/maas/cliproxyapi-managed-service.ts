import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import extractZip from '@electron-internal/extract-zip';
import { app, clipboard, shell } from 'electron';
import {
  CLIPROXYAPI_MANAGED_ADMIN_URL,
  CLIPROXYAPI_MANAGED_ENDPOINT,
  CLIPROXYAPI_MANAGED_VERSION,
  type CliProxyApiManagedActionResult,
  type CliProxyApiManagedCredentialActionResult,
  type CliProxyApiManagedOperation,
  type CliProxyApiManagedStatus,
} from '@shared/cliproxyapi-managed';
import { log } from '@main/lib/logger';
import { encryptedAppSecretsStore } from '../secrets/encrypted-app-secrets-store';
import { managedRuntimeDelay, managedRuntimeErrorMessage } from './docker-managed-runtime';
import { maasService } from './maas-service';

const STATUS_TIMEOUT_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1_000;
const STARTUP_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const CONFIG_FILENAME = 'config.yaml';
const VERSION_FILENAME = 'version.json';
const PID_FILENAME = 'cliproxyapi.pid';
const LICENSE_FILENAME = 'CLIProxyAPI-LICENSE.txt';
const API_KEY_SECRET = 'yoda-cliproxyapi-api-key';
const MANAGEMENT_KEY_SECRET = 'yoda-cliproxyapi-management-key';

type ArchiveKind = 'tar.gz' | 'zip';

type ReleaseAsset = {
  filename: string;
  sha256: string;
  archiveKind: ArchiveKind;
};

const RELEASE_ASSETS: Record<string, ReleaseAsset> = {
  'darwin-arm64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_darwin_aarch64.tar.gz`,
    sha256: '01ebcb3a683560c91f532fb124ac30edcc68945859e3ddf4880e09f1979ffdee',
    archiveKind: 'tar.gz',
  },
  'darwin-x64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_darwin_amd64.tar.gz`,
    sha256: '1f2dd819f3176d5ad85ad089d8aafff3214182a6135957ce6c938ad3273bd737',
    archiveKind: 'tar.gz',
  },
  'linux-arm64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_linux_aarch64.tar.gz`,
    sha256: '5ba28b842b9add6388b77b1672fd0ec9904ca1814c896b507ddebe5df42b4ec9',
    archiveKind: 'tar.gz',
  },
  'linux-x64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_linux_amd64.tar.gz`,
    sha256: '8933332737338be5d5cedae4b96254b9afc8dfe0f13c4322738c65fd7931ce0a',
    archiveKind: 'tar.gz',
  },
  'win32-arm64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_windows_aarch64.zip`,
    sha256: '3c78311457d36f34822b9e9633c23cf6cd5d810bbc4bb697dcb5ad0135bf38d3',
    archiveKind: 'zip',
  },
  'win32-x64': {
    filename: `CLIProxyAPI_${CLIPROXYAPI_MANAGED_VERSION}_windows_amd64.zip`,
    sha256: 'eb08b7905c9c9b88ebb1e7fcfa35777494d1e042228f6b7f25786e53848d352b',
    archiveKind: 'zip',
  },
};

const CLI_PROXY_API_LICENSE = `MIT License

Copyright (c) 2025-2005.9 Luis Pater
Copyright (c) 2025.9-present Router-For.ME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

type SecretStore = Pick<typeof encryptedAppSecretsStore, 'getSecret' | 'setSecret'>;
type MaasConnector = Pick<typeof maasService, 'connectPlatform'>;

type ManagedProcess = {
  pid: number | undefined;
  kill: (signal?: NodeJS.Signals) => boolean;
  onExit: (listener: () => void) => void;
  unref: () => void;
};

type LaunchManagedProcess = (
  executable: string,
  args: string[],
  options: { cwd: string }
) => ManagedProcess;

type ExtractArchive = (
  archivePath: string,
  destination: string,
  archiveKind: ArchiveKind
) => Promise<void>;

type CliProxyApiManagedServiceOptions = {
  getManagedDirectory?: () => string;
  fetch?: typeof globalThis.fetch;
  secretStore?: SecretStore;
  maasConnector?: MaasConnector;
  writeClipboard?: (value: string) => void;
  openExternal?: (url: string) => Promise<void>;
  launchProcess?: LaunchManagedProcess;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  extractArchive?: ExtractArchive;
  downloadArchive?: (asset: ReleaseAsset) => Promise<Buffer>;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
};

type ActiveOperation = {
  kind: CliProxyApiManagedOperation;
  target: 'running' | 'stopped';
  promise: Promise<CliProxyApiManagedActionResult>;
};

type ModelsResponse = {
  data?: unknown[];
};

type VersionMetadata = {
  version?: string;
  sha256?: string;
};

function defaultLaunchProcess(
  executable: string,
  args: string[],
  options: { cwd: string }
): ManagedProcess {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  return {
    pid: child.pid,
    kill: (signal) => child.kill(signal),
    onExit: (listener) => {
      child.once('exit', listener);
      child.once('error', listener);
    },
    unref: () => child.unref(),
  };
}

async function defaultExtractArchive(
  archivePath: string,
  destination: string,
  archiveKind: ArchiveKind
): Promise<void> {
  if (archiveKind === 'zip') {
    await extractZip(archivePath, { dir: destination });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-xzf', archivePath, '-C', destination], { timeout: 60_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function configFileContents(authDirectory: string, apiKey: string, managementKey: string): string {
  return `# Managed by Yoda. Account credentials remain in CLIProxyAPI's private auth directory.
host: "127.0.0.1"
port: 8317

remote-management:
  allow-remote: false
  secret-key: ${yamlString(managementKey)}
  disable-control-panel: false

auth-dir: ${yamlString(authDirectory)}
api-keys:
  - ${yamlString(apiKey)}

debug: false
logging-to-file: true
logs-max-total-size-mb: 256
usage-statistics-enabled: true
routing:
  strategy: "round-robin"
`;
}

export class CliProxyApiManagedService {
  private readonly getManagedDirectory: () => string;
  private readonly fetchApi: typeof globalThis.fetch;
  private readonly secretStore: SecretStore;
  private readonly maasConnector: MaasConnector;
  private readonly writeClipboard: (value: string) => void;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly launchProcess: LaunchManagedProcess;
  private readonly signalProcess: (pid: number, signal: NodeJS.Signals) => void;
  private readonly extractArchive: ExtractArchive;
  private readonly downloadReleaseArchive: (asset: ReleaseAsset) => Promise<Buffer>;
  private readonly platform: NodeJS.Platform;
  private readonly arch: NodeJS.Architecture;
  private activeOperation: ActiveOperation | null = null;
  private managedProcess: ManagedProcess | null = null;

  constructor(options: CliProxyApiManagedServiceOptions = {}) {
    this.getManagedDirectory =
      options.getManagedDirectory ?? (() => join(app.getPath('userData'), 'cliproxyapi'));
    this.fetchApi = options.fetch ?? globalThis.fetch;
    this.secretStore = options.secretStore ?? encryptedAppSecretsStore;
    this.maasConnector = options.maasConnector ?? maasService;
    this.writeClipboard = options.writeClipboard ?? ((value) => clipboard.writeText(value));
    this.openExternal = options.openExternal ?? ((url) => shell.openExternal(url));
    this.launchProcess = options.launchProcess ?? defaultLaunchProcess;
    this.signalProcess = options.signalProcess ?? ((pid, signal) => process.kill(pid, signal));
    this.extractArchive = options.extractArchive ?? defaultExtractArchive;
    this.downloadReleaseArchive =
      options.downloadArchive ?? ((asset) => this.downloadPinnedArchive(asset));
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
  }

  async getStatus(): Promise<CliProxyApiManagedStatus> {
    const asset = this.releaseAsset();
    const [installed, installedVersion, managementKey, apiKey] = await Promise.all([
      this.fileExists(this.executablePath()),
      this.readInstalledVersion(),
      this.secretStore.getSecret(MANAGEMENT_KEY_SECRET),
      this.secretStore.getSecret(API_KEY_SECRET),
    ]);

    if (!asset) {
      return this.createStatus({
        state: 'unsupported',
        installed,
        installedVersion,
        modelCount: null,
      });
    }

    if (installed && managementKey && (await this.probeManagement(managementKey))) {
      return this.createStatus({
        state: 'running',
        installed,
        installedVersion,
        modelCount: apiKey ? await this.getModelCount(apiKey) : null,
      });
    }

    if (await this.probeReachable()) {
      return this.createStatus({
        state: 'external-running',
        installed,
        installedVersion,
        modelCount: null,
      });
    }

    return this.createStatus({
      state: installed ? 'stopped' : 'not-installed',
      installed,
      installedVersion,
      modelCount: null,
    });
  }

  async install(): Promise<CliProxyApiManagedActionResult> {
    return this.runExclusive('installing', 'running', async () => {
      const status = await this.getStatus();
      if (!status.supported) {
        return {
          success: false,
          status,
          error: 'CLIProxyAPI does not publish a build for this system.',
        };
      }
      if (status.state === 'external-running') {
        return {
          success: false,
          status,
          error: 'Port 8317 already has an existing CLIProxyAPI service.',
        };
      }

      try {
        await this.installPinnedRelease();
        const secrets = await this.getOrCreateManagedSecrets();
        await this.ensureConfigFile(secrets.apiKey, secrets.managementKey);
        await this.launchAndConnect(secrets.apiKey, secrets.managementKey);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to install managed CLIProxyAPI:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'CLIProxyAPI installation failed.'),
        };
      }
    });
  }

  async start(): Promise<CliProxyApiManagedActionResult> {
    return this.runExclusive('starting', 'running', async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed CLIProxyAPI is not installed.' };
      }
      if (status.state === 'external-running') {
        return {
          success: false,
          status,
          error: 'Port 8317 already has an existing CLIProxyAPI service.',
        };
      }
      if (status.state === 'running') return { success: true, status };

      try {
        const secrets = await this.getOrCreateManagedSecrets();
        await this.ensureConfigFile(secrets.apiKey, secrets.managementKey);
        await this.launchAndConnect(secrets.apiKey, secrets.managementKey);
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to start managed CLIProxyAPI:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'CLIProxyAPI startup failed.'),
        };
      }
    });
  }

  async stop(): Promise<CliProxyApiManagedActionResult> {
    return this.runExclusive('stopping', 'stopped', async () => {
      const status = await this.getStatus();
      if (!status.installed) {
        return { success: false, status, error: 'Managed CLIProxyAPI is not installed.' };
      }
      if (status.state === 'stopped') return { success: true, status };
      if (status.state !== 'running') {
        return {
          success: false,
          status,
          error: 'The service on port 8317 is not managed by Yoda.',
        };
      }

      try {
        await this.terminateManagedProcess();
        await this.waitUntilStopped();
        return { success: true, status: await this.getStatus() };
      } catch (error) {
        log.error('Failed to stop managed CLIProxyAPI:', error);
        return {
          success: false,
          status: await this.getStatus(),
          error: managedRuntimeErrorMessage(error, 'CLIProxyAPI shutdown failed.'),
        };
      }
    });
  }

  async copyManagementKey(): Promise<CliProxyApiManagedCredentialActionResult> {
    try {
      await this.copyManagementKeyToClipboard();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: managedRuntimeErrorMessage(error, 'Failed to copy CLIProxyAPI management key.'),
      };
    }
  }

  async openAdmin(): Promise<CliProxyApiManagedCredentialActionResult> {
    try {
      const status = await this.getStatus();
      if (status.state !== 'running') {
        return { success: false, error: 'CLIProxyAPI is not running.' };
      }
      await this.copyManagementKeyToClipboard();
      await this.openExternal(CLIPROXYAPI_MANAGED_ADMIN_URL);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: managedRuntimeErrorMessage(error, 'Failed to open CLIProxyAPI management center.'),
      };
    }
  }

  async dispose(): Promise<void> {
    if (!this.managedProcess) return;
    try {
      this.managedProcess.kill('SIGTERM');
    } catch (error) {
      log.warn('Failed to stop CLIProxyAPI during application shutdown:', error);
    }
    this.managedProcess = null;
  }

  private async launchAndConnect(apiKey: string, managementKey: string): Promise<void> {
    if (await this.probeReachable()) {
      if (!(await this.probeManagement(managementKey))) {
        throw new Error('Port 8317 is already in use by another service.');
      }
      await this.connectYoda(apiKey);
      return;
    }

    const processHandle = this.launchProcess(
      this.executablePath(),
      ['--config', this.configPath()],
      { cwd: this.getManagedDirectory() }
    );
    if (!processHandle.pid) throw new Error('CLIProxyAPI did not return a process ID.');
    this.managedProcess = processHandle;
    processHandle.onExit(() => {
      if (this.managedProcess === processHandle) this.managedProcess = null;
    });
    processHandle.unref();
    await writeFile(this.pidPath(), `${processHandle.pid}\n`, { encoding: 'utf8', mode: 0o600 });
    await this.waitUntilReady(managementKey);
    await this.connectYoda(apiKey);
  }

  private async terminateManagedProcess(): Promise<void> {
    if (this.managedProcess) {
      this.managedProcess.kill('SIGTERM');
      this.managedProcess = null;
      return;
    }

    const pid = await this.readManagedPid();
    if (!pid) throw new Error('CLIProxyAPI process information is missing.');
    this.signalProcess(pid, 'SIGTERM');
  }

  private async waitUntilReady(managementKey: string): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.probeManagement(managementKey)) return;
      if (!this.managedProcess) throw new Error('CLIProxyAPI exited before becoming ready.');
      await managedRuntimeDelay(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error('CLIProxyAPI startup timed out.');
  }

  private async waitUntilStopped(): Promise<void> {
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!(await this.probeReachable())) {
        await unlink(this.pidPath()).catch(() => undefined);
        return;
      }
      await managedRuntimeDelay(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error('CLIProxyAPI shutdown timed out.');
  }

  private async installPinnedRelease(): Promise<void> {
    const asset = this.releaseAsset();
    if (!asset) throw new Error('Unsupported CLIProxyAPI platform.');

    const directory = this.getManagedDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryDirectory = await mkdtemp(join(directory, '.install-'));
    const archivePath = join(temporaryDirectory, asset.filename);
    const extractedDirectory = join(temporaryDirectory, 'extracted');
    await mkdir(extractedDirectory, { recursive: true, mode: 0o700 });

    try {
      const archive = await this.downloadReleaseArchive(asset);
      await writeFile(archivePath, archive, { mode: 0o600 });
      await this.extractArchive(archivePath, extractedDirectory, asset.archiveKind);
      const extractedExecutable = await this.findFile(
        extractedDirectory,
        this.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api'
      );
      if (!extractedExecutable) throw new Error('CLIProxyAPI archive has no executable.');

      const nextExecutable = `${this.executablePath()}.next`;
      await copyFile(extractedExecutable, nextExecutable);
      if (this.platform !== 'win32') await chmod(nextExecutable, 0o755);
      await rename(nextExecutable, this.executablePath());
      await writeFile(join(directory, LICENSE_FILENAME), CLI_PROXY_API_LICENSE, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await writeFile(
        this.versionPath(),
        `${JSON.stringify({ version: CLIPROXYAPI_MANAGED_VERSION, sha256: asset.sha256 }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async downloadPinnedArchive(asset: ReleaseAsset): Promise<Buffer> {
    const url = `https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLIPROXYAPI_MANAGED_VERSION}/${asset.filename}`;
    const response = await this.fetchApi(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'Yoda' },
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`CLIProxyAPI download returned HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
      throw new Error('CLIProxyAPI archive is larger than expected.');
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('CLIProxyAPI archive is larger than expected.');
    }
    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest !== asset.sha256) throw new Error('CLIProxyAPI archive checksum mismatch.');
    return archive;
  }

  private async ensureConfigFile(apiKey: string, managementKey: string): Promise<void> {
    if (await this.fileExists(this.configPath())) return;
    const directory = this.getManagedDirectory();
    const authDirectory = join(directory, 'auth');
    await mkdir(authDirectory, { recursive: true, mode: 0o700 });
    await writeFile(this.configPath(), configFileContents(authDirectory, apiKey, managementKey), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  private async getOrCreateManagedSecrets(): Promise<{
    apiKey: string;
    managementKey: string;
  }> {
    return {
      apiKey: await this.getOrCreateSecret(
        API_KEY_SECRET,
        () => `sk-yoda-${randomBytes(24).toString('base64url')}`
      ),
      managementKey: await this.getOrCreateSecret(MANAGEMENT_KEY_SECRET, () =>
        randomBytes(32).toString('base64url')
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

  private async copyManagementKeyToClipboard(): Promise<void> {
    const key = await this.secretStore.getSecret(MANAGEMENT_KEY_SECRET);
    if (!key) throw new Error('CLIProxyAPI management credential is missing.');
    this.writeClipboard(key);
  }

  private async connectYoda(apiKey: string): Promise<void> {
    const result = await this.maasConnector.connectPlatform({
      platformId: 'cliproxyapi',
      apiKey,
      displayName: 'CLIProxyAPI',
      endpoint: CLIPROXYAPI_MANAGED_ENDPOINT,
    });
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to connect Yoda to CLIProxyAPI.');
    }
  }

  private async probeManagement(managementKey: string): Promise<boolean> {
    try {
      const response = await this.fetchApi('http://127.0.0.1:8317/v0/management/config', {
        headers: { Authorization: `Bearer ${managementKey}` },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async probeReachable(): Promise<boolean> {
    try {
      await this.fetchApi(`${CLIPROXYAPI_MANAGED_ENDPOINT}/models`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async getModelCount(apiKey: string): Promise<number | null> {
    try {
      const response = await this.fetchApi(`${CLIPROXYAPI_MANAGED_ENDPOINT}/models`, {
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

  private createStatus({
    state,
    installed,
    installedVersion,
    modelCount,
  }: {
    state: CliProxyApiManagedStatus['state'];
    installed: boolean;
    installedVersion: string | null;
    modelCount: number | null;
  }): CliProxyApiManagedStatus {
    return {
      state,
      operation: this.activeOperation?.kind ?? null,
      supported: Boolean(this.releaseAsset()),
      managed: installed,
      installed,
      endpoint: CLIPROXYAPI_MANAGED_ENDPOINT,
      adminUrl: CLIPROXYAPI_MANAGED_ADMIN_URL,
      bundledVersion: CLIPROXYAPI_MANAGED_VERSION,
      installedVersion,
      modelCount,
    };
  }

  private async runExclusive(
    kind: CliProxyApiManagedOperation,
    target: ActiveOperation['target'],
    operation: () => Promise<CliProxyApiManagedActionResult>
  ): Promise<CliProxyApiManagedActionResult> {
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

  private releaseAsset(): ReleaseAsset | null {
    return RELEASE_ASSETS[`${this.platform}-${this.arch}`] ?? null;
  }

  private executablePath(): string {
    return join(
      this.getManagedDirectory(),
      this.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api'
    );
  }

  private configPath(): string {
    return join(this.getManagedDirectory(), CONFIG_FILENAME);
  }

  private versionPath(): string {
    return join(this.getManagedDirectory(), VERSION_FILENAME);
  }

  private pidPath(): string {
    return join(this.getManagedDirectory(), PID_FILENAME);
  }

  private async readInstalledVersion(): Promise<string | null> {
    try {
      const metadata = JSON.parse(await readFile(this.versionPath(), 'utf8')) as VersionMetadata;
      return typeof metadata.version === 'string' ? metadata.version : null;
    } catch {
      return null;
    }
  }

  private async readManagedPid(): Promise<number | null> {
    try {
      const pid = Number((await readFile(this.pidPath(), 'utf8')).trim());
      return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private async findFile(directory: string, filename: string): Promise<string | null> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === filename) return path;
      if (entry.isDirectory()) {
        const nested = await this.findFile(path, filename);
        if (nested) return nested;
      }
    }
    return null;
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

export const cliProxyApiManagedService = new CliProxyApiManagedService();
