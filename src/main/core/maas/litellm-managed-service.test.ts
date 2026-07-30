import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LITELLM_MANAGED_ADMIN_URL, LITELLM_MANAGED_ENDPOINT } from '@shared/litellm-managed';
import type { DockerCommandRunner } from './docker-managed-runtime';
import { LiteLlmManagedService } from './litellm-managed-service';

vi.mock('../secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
}));

vi.mock('./maas-service', () => ({
  maasService: {
    connectPlatform: vi.fn(),
  },
}));

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yoda-litellm-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createSecretStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store = {
    getSecret: vi.fn(async (key: string) => values.get(key) ?? null),
    setSecret: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteSecret: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
  return { store, values };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('LiteLlmManagedService', () => {
  it('reports that Docker Desktop is required when the docker executable is absent', async () => {
    const directory = await createTemporaryDirectory();
    const missingDocker: DockerCommandRunner = vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    const { store } = createSecretStore();
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker: missingDocker,
      fetch: vi.fn(async () => jsonResponse({ status: 'offline' }, 503)),
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      platform: 'darwin',
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'docker-missing',
      installed: false,
      dockerInstalled: false,
      dockerRunning: false,
      canStartDocker: true,
    });
  });

  it('reports Docker as starting immediately after opening the desktop app', async () => {
    const directory = await createTemporaryDirectory();
    let dockerRunning = false;
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      if (args[0] === '--version') {
        return { stdout: 'Docker version 29.4.1', stderr: '' };
      }
      if (args[0] === 'info' && dockerRunning) {
        return { stdout: '29.4.1', stderr: '' };
      }
      throw new Error('Docker daemon is still starting.');
    });
    const launchDockerDesktop = vi.fn(async () => undefined);
    const { store } = createSecretStore();
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: vi.fn(async () => jsonResponse({ status: 'offline' }, 503)),
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      launchDockerDesktop,
      platform: 'darwin',
    });

    await expect(service.startDockerDesktop()).resolves.toMatchObject({
      success: true,
      status: {
        state: 'docker-starting',
        dockerInstalled: true,
        dockerRunning: false,
      },
    });
    expect(launchDockerDesktop).toHaveBeenCalledOnce();

    dockerRunning = true;
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'not-installed',
      dockerRunning: true,
    });
  });

  it('downloads the pinned stack, initializes credentials, and connects Yoda with a virtual key', async () => {
    const directory = await createTemporaryDirectory();
    let started = false;
    const dockerCalls: string[][] = [];
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      dockerCalls.push(args);
      if (args[0] === '--version') {
        return { stdout: 'Docker version 28.0.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { stdout: '28.0.0', stderr: '' };
      }
      if (args.includes('up')) started = true;
      return { stdout: '', stderr: '' };
    });
    const fetchApi = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health/readiness')) {
        return started
          ? jsonResponse({ status: 'healthy', db: 'connected' })
          : jsonResponse({ status: 'offline' }, 503);
      }
      if (url.endsWith('/key/generate') && init?.method === 'POST') {
        return jsonResponse({ key: 'sk-yoda-virtual' });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({}, 404);
    });
    const { store, values } = createSecretStore();
    const connectPlatform = vi.fn(async () => ({ success: true as const }));
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: fetchApi as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform },
      platform: 'darwin',
    });

    const result = await service.install();

    expect(result).toMatchObject({
      success: true,
      status: { state: 'running', managed: true, modelCount: 0 },
    });
    expect(dockerCalls.some((args) => args.includes('pull'))).toBe(true);
    expect(dockerCalls.some((args) => args.includes('up'))).toBe(true);
    expect(connectPlatform).toHaveBeenCalledWith({
      platformId: 'litellm',
      apiKey: 'sk-yoda-virtual',
      displayName: 'LiteLLM',
      endpoint: LITELLM_MANAGED_ENDPOINT,
    });
    expect(values.get('yoda-litellm-master-key')).toMatch(/^sk-/);
    expect(values.get('yoda-litellm-salt-key')).toMatch(/^sk-/);
    expect(values.get('yoda-litellm-postgres-password')).toHaveLength(64);
    expect(values.get('yoda-litellm-virtual-key')).toBe('sk-yoda-virtual');

    const composeFile = await readFile(join(directory, 'compose.yaml'), 'utf8');
    expect(composeFile).toContain('ghcr.io/berriai/litellm-database:v1.90.2');
    expect(composeFile).toContain('${LITELLM_MASTER_KEY}');
    expect(composeFile).toContain('UI_USERNAME: "admin"');
    expect(composeFile).toContain('UI_PASSWORD: "${LITELLM_MASTER_KEY}"');
    expect(composeFile).toContain('127.0.0.1:4000:4000');
    expect(composeFile).not.toContain(values.get('yoda-litellm-master-key')!);
    expect(composeFile).not.toContain(values.get('yoda-litellm-postgres-password')!);
  });

  it('reuses an active installation when another request also targets a running gateway', async () => {
    const directory = await createTemporaryDirectory();
    let stackRunning = false;
    let releasePull!: () => void;
    let reportPullStarted!: () => void;
    const pullGate = new Promise<void>((resolve) => {
      releasePull = resolve;
    });
    const pullStarted = new Promise<void>((resolve) => {
      reportPullStarted = resolve;
    });
    const dockerCalls: string[][] = [];
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      dockerCalls.push(args);
      if (args[0] === '--version') {
        return { stdout: 'Docker version 28.0.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { stdout: '28.0.0', stderr: '' };
      }
      if (args.includes('pull')) {
        reportPullStarted();
        await pullGate;
      }
      if (args.includes('up')) stackRunning = true;
      return { stdout: '', stderr: '' };
    });
    const { store } = createSecretStore();
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/health/readiness')) {
          return stackRunning
            ? jsonResponse({ status: 'healthy', db: 'connected' })
            : jsonResponse({ status: 'offline' }, 503);
        }
        if (url.endsWith('/key/generate') && init?.method === 'POST') {
          return jsonResponse({ key: 'sk-yoda-virtual' });
        }
        if (url.endsWith('/v1/models')) {
          return jsonResponse({ data: [] });
        }
        return jsonResponse({}, 404);
      }) as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn(async () => ({ success: true as const })) },
      platform: 'darwin',
    });

    const installation = service.install();
    await pullStarted;
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'stopped',
      operation: 'installing',
    });

    const duplicateStart = service.start();
    releasePull();

    await expect(installation).resolves.toMatchObject({
      success: true,
      status: { state: 'running', operation: null },
    });
    await expect(duplicateStart).resolves.toMatchObject({
      success: true,
      status: { state: 'running', operation: null },
    });
    expect(dockerCalls.filter((args) => args.includes('pull'))).toHaveLength(1);
    expect(dockerCalls.filter((args) => args.includes('up'))).toHaveLength(1);
  });

  it('copies the managed administrator password on demand and before opening the console', async () => {
    const directory = await createTemporaryDirectory();
    const runDocker: DockerCommandRunner = vi.fn(async (args) =>
      args[0] === '--version'
        ? { stdout: 'Docker version 28.0.0', stderr: '' }
        : { stdout: '28.0.0', stderr: '' }
    );
    const { store } = createSecretStore({
      'yoda-litellm-master-key': 'sk-managed-admin',
    });
    const writeClipboard = vi.fn();
    const openExternal = vi.fn(async () => undefined);
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith('/health/readiness')
          ? jsonResponse({ status: 'healthy', db: 'connected' })
          : jsonResponse({ data: [] })
      ) as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      writeClipboard,
      openExternal,
      platform: 'darwin',
    });
    await writeFile(join(directory, 'compose.yaml'), 'services: {}', 'utf8');

    await expect(service.copyAdminPassword()).resolves.toEqual({ success: true });
    expect(writeClipboard).toHaveBeenCalledWith('sk-managed-admin');
    expect(openExternal).not.toHaveBeenCalled();

    writeClipboard.mockClear();
    await expect(service.openAdmin()).resolves.toEqual({ success: true });
    expect(writeClipboard).toHaveBeenCalledWith('sk-managed-admin');
    expect(openExternal).toHaveBeenCalledWith(LITELLM_MANAGED_ADMIN_URL);
  });

  it('starts and stops an initialized stack without replacing its stable credentials', async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory, 'compose.yaml'), 'services: {}', 'utf8');
    let started = false;
    const dockerCalls: string[][] = [];
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      dockerCalls.push(args);
      if (args[0] === '--version') {
        return { stdout: 'Docker version 28.0.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { stdout: '28.0.0', stderr: '' };
      }
      if (args.includes('up')) started = true;
      if (args.includes('stop')) started = false;
      return { stdout: '', stderr: '' };
    });
    const { store, values } = createSecretStore({
      'yoda-litellm-master-key': 'sk-stable-master',
      'yoda-litellm-salt-key': 'sk-stable-salt',
      'yoda-litellm-postgres-password': 'stable-database-password',
      'yoda-litellm-virtual-key': 'sk-stable-virtual',
    });
    const connectPlatform = vi.fn(async () => ({ success: true as const }));
    const service = new LiteLlmManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/health/readiness')) {
          return started
            ? jsonResponse({ status: 'healthy', db: 'connected' })
            : jsonResponse({ status: 'offline' }, 503);
        }
        return jsonResponse({ data: [] });
      }) as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform },
      platform: 'darwin',
    });

    await expect(service.start()).resolves.toMatchObject({
      success: true,
      status: { state: 'running' },
    });
    await expect(service.stop()).resolves.toMatchObject({
      success: true,
      status: { state: 'stopped' },
    });

    expect(dockerCalls.some((args) => args.includes('up'))).toBe(true);
    expect(dockerCalls.some((args) => args.includes('stop'))).toBe(true);
    expect(connectPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-stable-virtual' })
    );
    expect(values.get('yoda-litellm-master-key')).toBe('sk-stable-master');
    expect(values.get('yoda-litellm-salt-key')).toBe('sk-stable-salt');
  });
});
