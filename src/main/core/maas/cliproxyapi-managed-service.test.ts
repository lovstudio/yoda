import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIPROXYAPI_MANAGED_ADMIN_URL,
  CLIPROXYAPI_MANAGED_ENDPOINT,
} from '@shared/cliproxyapi-managed';
import { CliProxyApiManagedService } from './cliproxyapi-managed-service';

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
  const directory = await mkdtemp(join(tmpdir(), 'yoda-cliproxyapi-test-'));
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

describe('CliProxyApiManagedService', () => {
  it('installs the pinned runtime, starts it, and connects Yoda', async () => {
    const directory = await createTemporaryDirectory();
    const { store, values } = createSecretStore();
    const connectPlatform = vi.fn(async () => ({ success: true as const }));
    const writeClipboard = vi.fn();
    const openExternal = vi.fn(async () => undefined);
    let running = false;

    const service = new CliProxyApiManagedService({
      getManagedDirectory: () => directory,
      platform: 'darwin',
      arch: 'arm64',
      secretStore: store,
      maasConnector: { connectPlatform },
      writeClipboard,
      openExternal,
      downloadArchive: vi.fn(async () => Buffer.from('fixture archive')),
      extractArchive: vi.fn(async (_archive, destination) => {
        await writeFile(join(destination, 'cli-proxy-api'), 'fixture executable');
      }),
      launchProcess: vi.fn(() => ({
        pid: 43210,
        kill: vi.fn(() => {
          running = false;
          return true;
        }),
        onExit: vi.fn(),
        unref: vi.fn(() => {
          running = true;
        }),
      })),
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (!running) throw new TypeError('offline');
        const url = String(input);
        if (url.endsWith('/v0/management/config')) return jsonResponse({ port: 8317 });
        if (url.endsWith('/v1/models')) {
          return init?.headers
            ? jsonResponse({ data: [{ id: 'claude' }, { id: 'gemini' }] })
            : jsonResponse({}, 401);
        }
        return jsonResponse({}, 404);
      }) as typeof fetch,
    });

    const result = await service.install();

    expect(result).toMatchObject({
      success: true,
      status: { state: 'running', managed: true, modelCount: 2 },
    });
    expect(connectPlatform).toHaveBeenCalledWith({
      platformId: 'cliproxyapi',
      apiKey: values.get('yoda-cliproxyapi-api-key'),
      displayName: 'CLIProxyAPI',
      endpoint: CLIPROXYAPI_MANAGED_ENDPOINT,
    });

    const config = await readFile(join(directory, 'config.yaml'), 'utf8');
    expect(config).toContain('host: "127.0.0.1"');
    expect(config).toContain('port: 8317');
    expect(config).toContain('allow-remote: false');
    expect(config).not.toContain('fixture archive');
    expect(await readFile(join(directory, 'version.json'), 'utf8')).toContain('7.2.120');
    expect(await readFile(join(directory, 'CLIProxyAPI-LICENSE.txt'), 'utf8')).toContain(
      'MIT License'
    );

    await expect(service.openAdmin()).resolves.toEqual({ success: true });
    expect(writeClipboard).toHaveBeenCalledWith(values.get('yoda-cliproxyapi-management-key'));
    expect(openExternal).toHaveBeenCalledWith(CLIPROXYAPI_MANAGED_ADMIN_URL);

    await expect(service.stop()).resolves.toMatchObject({
      success: true,
      status: { state: 'stopped' },
    });
  });

  it('recognizes an existing service on the default port without taking ownership', async () => {
    const directory = await createTemporaryDirectory();
    const { store } = createSecretStore();
    const service = new CliProxyApiManagedService({
      getManagedDirectory: () => directory,
      platform: 'darwin',
      arch: 'arm64',
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      fetch: vi.fn(async () => jsonResponse({}, 401)) as typeof fetch,
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'external-running',
      managed: false,
      installed: false,
    });
    await expect(service.install()).resolves.toMatchObject({
      success: false,
      status: { state: 'external-running' },
    });
  });

  it('rejects a downloaded archive whose checksum does not match the pinned release', async () => {
    const directory = await createTemporaryDirectory();
    const { store } = createSecretStore();
    const service = new CliProxyApiManagedService({
      getManagedDirectory: () => directory,
      platform: 'darwin',
      arch: 'arm64',
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      fetch: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('github.com/')) return new Response('invalid archive');
        throw new TypeError('offline');
      }) as typeof fetch,
    });

    await expect(service.install()).resolves.toMatchObject({
      success: false,
      status: { state: 'not-installed' },
      error: expect.stringContaining('checksum mismatch'),
    });
  });

  it('reports unsupported platforms without downloading anything', async () => {
    const directory = await createTemporaryDirectory();
    const { store } = createSecretStore();
    const downloadArchive = vi.fn(async () => Buffer.from('unused'));
    const service = new CliProxyApiManagedService({
      getManagedDirectory: () => directory,
      platform: 'freebsd',
      arch: 'x64',
      secretStore: store,
      maasConnector: { connectPlatform: vi.fn() },
      downloadArchive,
    });

    await expect(service.install()).resolves.toMatchObject({
      success: false,
      status: { state: 'unsupported', supported: false },
    });
    expect(downloadArchive).not.toHaveBeenCalled();
  });
});
