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
}));

vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
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
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
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
    vi.clearAllMocks();
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
});
