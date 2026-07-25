import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaasSettings, RuntimeCustomConfig } from '@shared/app-settings';
import { MaasService } from './maas-service';

const mocks = vi.hoisted(() => ({
  settings: {
    selectedPlatformId: 'zenmux',
    connections: [],
    runtimeBindings: [],
  } as MaasSettings,
  runtimeConfigs: {} as Record<string, RuntimeCustomConfig>,
  failRuntimeId: null as string | null,
  secrets: {} as Record<string, string>,
  clipboardWriteText: vi.fn(),
  migrateLegacyCodexMaasHistory: vi.fn(),
}));

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.clipboardWriteText },
  net: { request: vi.fn() },
}));

vi.mock('../settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getOverrides: vi.fn(async () => structuredClone(mocks.runtimeConfigs)),
    replaceOverrides: vi.fn(async (configs: Record<string, RuntimeCustomConfig>) => {
      mocks.runtimeConfigs = structuredClone(configs);
    }),
    getItem: vi.fn(async (runtimeId: string) => mocks.runtimeConfigs[runtimeId]),
    updateItem: vi.fn(async (runtimeId: string, config: RuntimeCustomConfig) => {
      if (mocks.failRuntimeId === runtimeId) throw new Error(`failed ${runtimeId}`);
      mocks.runtimeConfigs[runtimeId] = structuredClone(config);
    }),
  },
}));

vi.mock('../settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => structuredClone(mocks.settings)),
    update: vi.fn(async (_key: string, value: Partial<MaasSettings>) => {
      mocks.settings = { ...mocks.settings, ...structuredClone(value) };
    }),
  },
}));

vi.mock('../secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: vi.fn(async (key: string) => mocks.secrets[key]),
    setSecret: vi.fn(async (key: string, value: string) => {
      mocks.secrets[key] = value;
    }),
    deleteSecret: vi.fn(async (key: string) => {
      delete mocks.secrets[key];
    }),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

vi.mock('./platform-info-store', () => ({
  getMaasPlatformInfoSnapshot: vi.fn(),
  setMaasPlatformInfoSnapshot: vi.fn(),
}));

vi.mock('./codex-history-compat', () => ({
  migrateLegacyCodexMaasHistoryForConfig: mocks.migrateLegacyCodexMaasHistory,
}));

describe('global MaaS binding', () => {
  beforeEach(() => {
    mocks.settings = {
      selectedPlatformId: 'zenmux',
      connections: [],
      runtimeBindings: [],
    };
    mocks.runtimeConfigs = {
      codex: { authProvider: 'official-api', defaultModel: 'gpt-5' },
      claude: {
        authProvider: 'official-subscription',
        env: { KEEP_ME: '1' },
      },
      qwen: { authProvider: 'official-subscription' },
    };
    mocks.failRuntimeId = null;
    mocks.secrets = {};
    vi.clearAllMocks();
    mocks.migrateLegacyCodexMaasHistory.mockReturnValue({ rows: 0, files: 0 });
  });

  it('backs up every compatible Client, switches platforms, and restores the originals', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    });

    await expect(
      service.setGlobalBinding({ platformId: 'zenmux', enabled: true })
    ).resolves.toEqual({ success: true });
    expect(mocks.runtimeConfigs.codex).toMatchObject({
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
      defaultModel: 'gpt-5',
    });
    expect(mocks.migrateLegacyCodexMaasHistory).toHaveBeenCalledWith({
      authProvider: 'official-api',
      defaultModel: 'gpt-5',
    });
    expect(mocks.runtimeConfigs.claude).toMatchObject({
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
      env: { KEEP_ME: '1' },
    });
    expect(mocks.runtimeConfigs.qwen.authProvider).toBe('official-subscription');
    expect(mocks.settings.runtimeBindings).toHaveLength(2);
    expect(mocks.settings.runtimeBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeId: 'codex',
          previousAuthProvider: 'official-api',
        }),
        expect.objectContaining({
          runtimeId: 'claude',
          previousAuthProvider: 'official-subscription',
        }),
      ])
    );
    await expect(service.getGlobalBinding()).resolves.toMatchObject({
      platformId: 'zenmux',
      enabled: true,
      effective: true,
      runtimeIds: expect.arrayContaining(['codex', 'claude']),
    });

    await expect(
      service.setGlobalBinding({ platformId: 'openrouter', enabled: true })
    ).resolves.toEqual({ success: true });
    expect(mocks.settings.runtimeBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeId: 'codex',
          platformId: 'openrouter',
          previousAuthProvider: 'official-api',
        }),
        expect.objectContaining({
          runtimeId: 'claude',
          platformId: 'openrouter',
          previousAuthProvider: 'official-subscription',
        }),
      ])
    );
    expect(new Set(mocks.settings.runtimeBindings.map((binding) => binding.platformId))).toEqual(
      new Set(['openrouter'])
    );

    await expect(
      service.setGlobalBinding({ platformId: 'openrouter', enabled: false })
    ).resolves.toEqual({ success: true });
    expect(mocks.runtimeConfigs.codex).toEqual({
      authProvider: 'official-api',
      defaultModel: 'gpt-5',
    });
    expect(mocks.runtimeConfigs.claude).toEqual({
      authProvider: 'official-subscription',
      env: { KEEP_ME: '1' },
    });
    expect(mocks.settings.runtimeBindings).toEqual([]);
  });

  it('rolls back every Client when a global switch fails midway', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    });
    const originalConfigs = structuredClone(mocks.runtimeConfigs);
    const originalSettings = structuredClone(mocks.settings);
    mocks.failRuntimeId = 'claude';

    const result = await service.setGlobalBinding({ platformId: 'zenmux', enabled: true });

    expect(result).toEqual({ success: false, error: 'failed claude' });
    expect(mocks.runtimeConfigs).toEqual(originalConfigs);
    expect(mocks.settings).toEqual(originalSettings);
  });

  it('keeps zero or one Custom instance globally active when switching instances', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      endpoint: 'https://custom.example.test/v1',
      apiKey: 'secret',
    });

    await expect(
      service.setGlobalBinding({ platformId: 'custom:first', enabled: true })
    ).resolves.toEqual({ success: true });
    expect(new Set(mocks.settings.runtimeBindings.map((binding) => binding.platformId))).toEqual(
      new Set(['custom:first'])
    );

    await expect(
      service.setGlobalBinding({ platformId: 'custom:second', enabled: true })
    ).resolves.toEqual({ success: true });
    expect(new Set(mocks.settings.runtimeBindings.map((binding) => binding.platformId))).toEqual(
      new Set(['custom:second'])
    );

    await expect(
      service.setGlobalBinding({ platformId: 'custom:second', enabled: false })
    ).resolves.toEqual({ success: true });
    expect(mocks.settings.runtimeBindings).toEqual([]);
  });

  it('rejects activating a second platform through the per-Client RPC', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    });

    await expect(
      service.setRuntimeBinding({ runtimeId: 'codex', platformId: 'zenmux', enabled: true })
    ).resolves.toEqual({ success: true });
    await expect(
      service.setRuntimeBinding({ runtimeId: 'claude', platformId: 'openrouter', enabled: true })
    ).resolves.toEqual({
      success: false,
      error: 'Only one MaaS platform can be active at a time.',
    });
    expect(new Set(mocks.settings.runtimeBindings.map((binding) => binding.platformId))).toEqual(
      new Set(['zenmux'])
    );
  });
});

describe('stored MaaS keys', () => {
  beforeEach(() => {
    mocks.settings = {
      selectedPlatformId: 'zenmux',
      connections: [
        {
          platformId: 'zenmux',
          displayName: 'ZenMux',
          endpoint: 'https://zenmux.ai/api/v1',
          keyFingerprint: 'ma...nt',
          inferenceKeyFingerprint: 'in...ce',
          connectedAt: '2026-07-16T00:00:00.000Z',
          lastCheckedAt: null,
        },
      ],
      runtimeBindings: [],
    };
    mocks.secrets = {
      'yoda-maas-token:zenmux': 'management-secret',
      'yoda-maas-inference-token:zenmux': 'inference-secret',
    };
    vi.clearAllMocks();
  });

  it('distinguishes saved platforms from built-in platforms that have not been added', async () => {
    const service = new MaasService();

    const connections = await service.listConnections();

    expect(connections.find((connection) => connection.platformId === 'zenmux')).toMatchObject({
      configured: true,
      connected: true,
    });
    expect(connections.find((connection) => connection.platformId === 'openrouter')).toMatchObject({
      configured: false,
      connected: false,
    });
  });

  it('copies the selected key kind without exposing the other stored key', async () => {
    const service = new MaasService();

    await expect(
      service.copyStoredApiKeyToClipboard({ platformId: 'zenmux', kind: 'inference' })
    ).resolves.toEqual({ success: true });
    expect(mocks.clipboardWriteText).toHaveBeenLastCalledWith('inference-secret');

    await expect(
      service.copyStoredApiKeyToClipboard({ platformId: 'zenmux', kind: 'primary' })
    ).resolves.toEqual({ success: true });
    expect(mocks.clipboardWriteText).toHaveBeenLastCalledWith('management-secret');
  });

  it('saves and lists multiple Custom connections with isolated keys', async () => {
    mocks.settings = {
      selectedPlatformId: 'zenmux',
      connections: [],
      runtimeBindings: [],
    };
    mocks.secrets = {};
    const service = new MaasService();

    await expect(
      service.connectPlatform({
        platformId: 'custom:first',
        displayName: 'First Custom',
        endpoint: 'https://first.example.test/v1',
        apiKey: 'first-secret',
      })
    ).resolves.toMatchObject({ success: true });
    await expect(
      service.connectPlatform({
        platformId: 'custom:second',
        displayName: 'Second Custom',
        endpoint: 'https://second.example.test/v1',
        apiKey: 'second-secret',
      })
    ).resolves.toMatchObject({ success: true });

    expect(mocks.secrets).toMatchObject({
      'yoda-maas-token:custom:first': 'first-secret',
      'yoda-maas-token:custom:second': 'second-secret',
    });
    expect(mocks.settings.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platformId: 'custom:first', displayName: 'First Custom' }),
        expect.objectContaining({ platformId: 'custom:second', displayName: 'Second Custom' }),
      ])
    );

    const connections = await service.listConnections();
    expect(connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platformId: 'custom:first',
          displayName: 'First Custom',
          connected: true,
        }),
        expect.objectContaining({
          platformId: 'custom:second',
          displayName: 'Second Custom',
          connected: true,
        }),
      ])
    );
  });

  it('loads a legacy fixed Custom connection under the new Custom name', async () => {
    mocks.settings = {
      selectedPlatformId: 'custom',
      connections: [
        {
          platformId: 'custom',
          displayName: 'Custom OpenAI',
          endpoint: 'https://legacy.example.test/v1',
          keyFingerprint: 'le...cy',
          inferenceKeyFingerprint: 'le...cy',
          connectedAt: '2026-07-16T00:00:00.000Z',
          lastCheckedAt: null,
        },
      ],
      runtimeBindings: [],
    };
    mocks.secrets = { 'yoda-maas-token:custom': 'legacy-secret' };

    const connections = await new MaasService().listConnections();

    expect(connections.find((connection) => connection.platformId === 'custom')).toMatchObject({
      displayName: 'Custom',
      configured: true,
      connected: true,
    });
  });
});
