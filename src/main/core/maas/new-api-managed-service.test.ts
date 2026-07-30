import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEW_API_MANAGED_ADMIN_URL, NEW_API_MANAGED_ENDPOINT } from '@shared/new-api-managed';
import type { DockerCommandRunner } from './docker-managed-runtime';
import { NewApiManagedService } from './new-api-managed-service';

vi.mock('../secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
  },
}));

vi.mock('./maas-service', () => ({
  maasService: {
    connectPlatform: vi.fn(),
  },
}));

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'yoda-new-api-test-'));
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

describe('NewApiManagedService', () => {
  it('reports that Docker Desktop is required when the docker executable is absent', async () => {
    const directory = await createTemporaryDirectory();
    const missingDocker: DockerCommandRunner = vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    const { store } = createSecretStore();
    const service = new NewApiManagedService({
      getManagedDirectory: () => directory,
      runDocker: missingDocker,
      fetch: vi.fn(async () => jsonResponse({}, 503)),
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

  it('installs the pinned single-container image and completes setup without manual credentials', async () => {
    const directory = await createTemporaryDirectory();
    let serviceReachable = false;
    let initialized = false;
    let tokenCreated = false;
    const dockerCalls: string[][] = [];
    const requestBodies: unknown[] = [];
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      dockerCalls.push(args);
      if (args[0] === '--version') {
        return { stdout: 'Docker version 28.0.0', stderr: '' };
      }
      if (args[0] === 'info') {
        return { stdout: '28.0.0', stderr: '' };
      }
      if (args.includes('up')) serviceReachable = true;
      return { stdout: '', stderr: '' };
    });
    const fetchApi = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/setup') && init?.method === 'POST') {
        requestBodies.push(JSON.parse(String(init.body)));
        initialized = true;
        return jsonResponse({ success: true });
      }
      if (url.endsWith('/api/setup')) {
        return serviceReachable
          ? jsonResponse({ success: true, data: { status: initialized } })
          : jsonResponse({}, 503);
      }
      if (url.endsWith('/api/user/login')) {
        requestBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ success: true, data: { access_token: 'dashboard-access' } });
      }
      if (url.includes('/api/token/search')) {
        return jsonResponse({
          success: true,
          data: { items: tokenCreated ? [{ id: 42, name: 'Yoda' }] : [] },
        });
      }
      if (url.endsWith('/api/token/') && init?.method === 'POST') {
        requestBodies.push(JSON.parse(String(init.body)));
        tokenCreated = true;
        return jsonResponse({ success: true });
      }
      if (url.endsWith('/api/token/42/key')) {
        return jsonResponse({ success: true, data: { key: 'new-api-yoda-token' } });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({}, 404);
    });
    const { store, values } = createSecretStore();
    const connectPlatform = vi.fn(async () => ({ success: true as const }));
    const service = new NewApiManagedService({
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
      status: {
        state: 'running',
        managed: true,
        initialized: true,
        credentialsAvailable: true,
        modelCount: 0,
      },
    });
    expect(dockerCalls.some((args) => args.includes('pull'))).toBe(true);
    expect(dockerCalls.some((args) => args.includes('up'))).toBe(true);
    expect(requestBodies).toContainEqual(
      expect.objectContaining({
        username: 'admin',
        SelfUseModeEnabled: true,
        DemoSiteEnabled: false,
      })
    );
    expect(requestBodies).toContainEqual(
      expect.objectContaining({
        name: 'Yoda',
        unlimited_quota: true,
        expired_time: -1,
      })
    );
    expect(connectPlatform).toHaveBeenCalledWith({
      platformId: 'newapi',
      apiKey: 'sk-new-api-yoda-token',
      displayName: 'New API',
      endpoint: NEW_API_MANAGED_ENDPOINT,
    });
    expect(values.get('yoda-new-api-session-secret')).toHaveLength(64);
    expect(values.get('yoda-new-api-admin-password')?.length).toBeGreaterThanOrEqual(24);
    expect(values.get('yoda-new-api-api-key')).toBe('sk-new-api-yoda-token');

    const composeFile = await readFile(join(directory, 'compose.yaml'), 'utf8');
    expect(composeFile).toContain('calciumion/new-api:v1.0.0-rc.22');
    expect(composeFile).toContain('127.0.0.1:4001:3000');
    expect(composeFile).toContain('${NEW_API_SESSION_SECRET}');
    expect(composeFile).not.toContain(values.get('yoda-new-api-session-secret')!);
    expect(composeFile).not.toContain(values.get('yoda-new-api-admin-password')!);
  });

  it('reuses the same active install when the action is clicked twice', async () => {
    const directory = await createTemporaryDirectory();
    let serviceReachable = false;
    let initialized = false;
    let tokenCreated = false;
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
      if (args[0] === '--version') return { stdout: 'Docker version 28.0.0', stderr: '' };
      if (args[0] === 'info') return { stdout: '28.0.0', stderr: '' };
      if (args.includes('pull')) {
        reportPullStarted();
        await pullGate;
      }
      if (args.includes('up')) serviceReachable = true;
      return { stdout: '', stderr: '' };
    });
    const fetchApi = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/setup') && init?.method === 'POST') {
        initialized = true;
        return jsonResponse({ success: true });
      }
      if (url.endsWith('/api/setup')) {
        return serviceReachable
          ? jsonResponse({ success: true, data: { status: initialized } })
          : jsonResponse({}, 503);
      }
      if (url.endsWith('/api/user/login')) {
        return jsonResponse({ success: true, data: { access_token: 'dashboard-access' } });
      }
      if (url.includes('/api/token/search')) {
        return jsonResponse({
          success: true,
          data: { items: tokenCreated ? [{ id: 42, name: 'Yoda' }] : [] },
        });
      }
      if (url.endsWith('/api/token/')) {
        tokenCreated = true;
        return jsonResponse({ success: true });
      }
      if (url.endsWith('/api/token/42/key')) {
        return jsonResponse({ success: true, data: { key: 'stable-token' } });
      }
      if (url.endsWith('/v1/models')) return jsonResponse({ data: [] });
      return jsonResponse({}, 404);
    });
    const { store } = createSecretStore();
    const service = new NewApiManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: fetchApi as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn(async () => ({ success: true })) },
      platform: 'darwin',
    });

    const firstInstall = service.install();
    await pullStarted;
    const secondInstall = service.install();
    releasePull();

    await expect(Promise.all([firstInstall, secondInstall])).resolves.toEqual([
      expect.objectContaining({ success: true }),
      expect.objectContaining({ success: true }),
    ]);
    expect(dockerCalls.filter((args) => args.includes('pull'))).toHaveLength(1);
  });

  it('copies the generated password before opening the managed console', async () => {
    const directory = await createTemporaryDirectory();
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(directory, 'compose.yaml'), 'services: {}')
    );
    const runDocker: DockerCommandRunner = vi.fn(async (args) => {
      if (args[0] === '--version') return { stdout: 'Docker version 28.0.0', stderr: '' };
      return { stdout: '28.0.0', stderr: '' };
    });
    const { store } = createSecretStore({
      'yoda-new-api-admin-password': 'managed-password',
      'yoda-new-api-api-key': 'sk-managed-token',
    });
    const writeClipboard = vi.fn();
    const openExternal = vi.fn(async () => undefined);
    const service = new NewApiManagedService({
      getManagedDirectory: () => directory,
      runDocker,
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith('/api/setup')
          ? jsonResponse({ success: true, data: { status: true } })
          : jsonResponse({ data: [] })
      ) as typeof fetch,
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      writeClipboard,
      openExternal,
      platform: 'darwin',
    });

    await expect(service.openAdmin()).resolves.toEqual({ success: true });
    expect(writeClipboard).toHaveBeenCalledWith('managed-password');
    expect(openExternal).toHaveBeenCalledWith(NEW_API_MANAGED_ADMIN_URL);
  });
});
