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
  codexAuthDisable: vi.fn(),
  codexAuthEnable: vi.fn(),
  codexAuthRollback: vi.fn(),
  extensionGet: vi.fn(),
  gatewayClear: vi.fn(),
  gatewayConfigure: vi.fn(),
  gatewayProviderId: null as string | null,
  gatewayRollback: vi.fn(),
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

vi.mock('./codex-maas-auth-switch', () => ({
  codexMaasAuthSwitch: {
    enable: mocks.codexAuthEnable,
    disable: mocks.codexAuthDisable,
  },
}));

vi.mock('../extensions/extension-marketplace-service', () => ({
  extensionMarketplaceService: {
    getExtension: mocks.extensionGet,
  },
}));

vi.mock('../extensions/maas-gateway/runtime', () => ({
  maasGatewayExtensionRuntime: {
    clear: mocks.gatewayClear,
    configure: mocks.gatewayConfigure,
    getConnection: vi.fn(() => ({
      baseUrl: 'http://127.0.0.1:15721/v1',
      admissionToken: 'local-gateway-token',
    })),
    getStatus: vi.fn(() => ({
      state: 'running',
      configuredProviderId: mocks.gatewayProviderId,
    })),
  },
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
    mocks.codexAuthEnable.mockResolvedValue(mocks.codexAuthRollback);
    mocks.codexAuthDisable.mockResolvedValue(mocks.codexAuthRollback);
    mocks.extensionGet.mockResolvedValue({
      supported: true,
      installation: { enabled: true },
      runtime: { state: 'running' },
    });
    mocks.gatewayClear.mockResolvedValue(undefined);
    mocks.gatewayProviderId = null;
    mocks.gatewayConfigure.mockImplementation(async (configuration: { providerId: string }) => {
      mocks.gatewayProviderId = configuration.providerId;
      return mocks.gatewayRollback;
    });
    mocks.migrateLegacyCodexMaasHistory.mockReturnValue({ rows: 0, files: 0 });
  });

  it('replays an active Codex binding at startup so legacy native files are upgraded', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api', defaultModel: 'gpt-5' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    mocks.runtimeConfigs.codex = {
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
      defaultModel: 'gpt-5',
    };
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'inference-secret',
    });

    await expect(service.reconcileActiveBindings()).resolves.toBeUndefined();

    expect(mocks.codexAuthEnable).toHaveBeenCalledOnce();
    expect(mocks.codexAuthEnable).toHaveBeenCalledWith({
      codexHome: expect.any(String),
      platformId: 'zenmux',
      displayName: 'ZenMux',
      gatewayBaseUrl: 'http://127.0.0.1:15721/v1',
      gatewayToken: 'local-gateway-token',
    });
    expect(mocks.gatewayConfigure).toHaveBeenCalledWith({
      providerId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'inference-secret',
    });
  });

  it('does not touch Codex native files when no MaaS binding is active', async () => {
    const service = new MaasService();

    await expect(service.reconcileActiveBindings()).resolves.toBeUndefined();

    expect(mocks.codexAuthEnable).not.toHaveBeenCalled();
  });

  it('restores the selected Codex account root before a native resume', async () => {
    const service = new MaasService();

    await expect(service.reconcileCodexStateRoot('/state/account-a')).resolves.toBeUndefined();

    expect(mocks.codexAuthDisable).toHaveBeenCalledWith({ codexHome: '/state/account-a' });
    expect(mocks.codexAuthEnable).not.toHaveBeenCalled();
  });

  it('applies the active Yoda MaaS route to the selected Codex account root', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'inference-secret',
    });

    await expect(service.reconcileCodexStateRoot('/state/account-b')).resolves.toBeUndefined();

    expect(mocks.codexAuthEnable).toHaveBeenCalledWith({
      codexHome: '/state/account-b',
      platformId: 'zenmux',
      displayName: 'ZenMux',
      gatewayBaseUrl: 'http://127.0.0.1:15721/v1',
      gatewayToken: 'local-gateway-token',
    });
    expect(mocks.gatewayConfigure).toHaveBeenCalledWith({
      providerId: 'zenmux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'inference-secret',
    });
  });

  it('repairs a split runtime binding and rolls native files back if persistence fails', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'ZenMux',
      endpoint: 'https://zenmux.ai/api/v1',
      apiKey: 'inference-secret',
    });
    mocks.failRuntimeId = 'codex';

    await expect(service.reconcileActiveBindings()).rejects.toThrow('failed codex');

    expect(mocks.codexAuthEnable).toHaveBeenCalledOnce();
    expect(mocks.codexAuthRollback).toHaveBeenCalledOnce();
  });

  it('leaves a persisted binding untouched when its inference credential is missing', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue(undefined);

    await expect(service.reconcileActiveBindings()).rejects.toThrow(
      'missing its inference credential'
    );
    expect(mocks.codexAuthEnable).not.toHaveBeenCalled();
    expect(mocks.settings.runtimeBindings).toHaveLength(1);
  });

  it('backs up every compatible Client, switches platforms, and restores the originals', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'MaaS Test',
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
    expect(mocks.codexAuthEnable).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: 'zenmux',
        displayName: 'MaaS Test',
        gatewayBaseUrl: 'http://127.0.0.1:15721/v1',
        gatewayToken: 'local-gateway-token',
      })
    );
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
          previousConfig: {
            authProvider: 'official-api',
            defaultModel: 'gpt-5',
          },
        }),
        expect.objectContaining({
          runtimeId: 'claude',
          previousAuthProvider: 'official-subscription',
          previousConfig: {
            authProvider: 'official-subscription',
            env: { KEEP_ME: '1' },
          },
        }),
      ])
    );
    await expect(service.getGlobalBinding()).resolves.toMatchObject({
      platformId: 'zenmux',
      enabled: true,
      effective: true,
      runtimeIds: expect.arrayContaining(['codex', 'claude']),
    });

    mocks.runtimeConfigs.codex = {
      ...mocks.runtimeConfigs.codex,
      defaultModel: 'changed-while-enabled',
      env: { TEMPORARY: '1' },
    };
    mocks.runtimeConfigs.claude = {
      ...mocks.runtimeConfigs.claude,
      extraArgs: '--temporary',
      env: { TEMPORARY: '1' },
    };

    await expect(
      service.setGlobalBinding({ platformId: 'openrouter', enabled: true })
    ).resolves.toEqual({ success: true });
    expect(mocks.settings.runtimeBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeId: 'codex',
          platformId: 'openrouter',
          previousAuthProvider: 'official-api',
          previousConfig: {
            authProvider: 'official-api',
            defaultModel: 'gpt-5',
          },
        }),
        expect.objectContaining({
          runtimeId: 'claude',
          platformId: 'openrouter',
          previousAuthProvider: 'official-subscription',
          previousConfig: {
            authProvider: 'official-subscription',
            env: { KEEP_ME: '1' },
          },
        }),
      ])
    );
    expect(new Set(mocks.settings.runtimeBindings.map((binding) => binding.platformId))).toEqual(
      new Set(['openrouter'])
    );
    expect(mocks.codexAuthEnable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        platformId: 'openrouter',
        displayName: 'MaaS Test',
        gatewayBaseUrl: 'http://127.0.0.1:15721/v1',
        gatewayToken: 'local-gateway-token',
      })
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
    expect(mocks.codexAuthDisable).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'not installed',
      { supported: true, installation: null, runtime: null },
      'Install Yoda MaaS Gateway from Marketplace before enabling MaaS.',
    ],
    [
      'disabled',
      { supported: true, installation: { enabled: false }, runtime: { state: 'stopped' } },
      'Enable Yoda MaaS Gateway from Marketplace before enabling MaaS.',
    ],
    [
      'not running',
      { supported: true, installation: { enabled: true }, runtime: { state: 'error' } },
      'Yoda MaaS Gateway is not running normally.',
    ],
    [
      'unsupported',
      { supported: false, installation: null, runtime: null },
      'Yoda MaaS Gateway is unavailable on this platform.',
    ],
  ])('rejects MaaS enable when the Gateway is %s', async (_state, extension, error) => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'MaaS Test',
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    });
    mocks.extensionGet.mockResolvedValue(extension);

    await expect(
      service.setGlobalBinding({ platformId: 'zenmux', enabled: true })
    ).resolves.toEqual({ success: false, error });
    expect(mocks.gatewayConfigure).not.toHaveBeenCalled();
    expect(mocks.codexAuthEnable).not.toHaveBeenCalled();
    expect(mocks.settings.runtimeBindings).toEqual([]);
  });

  it('rolls back every Client when a global switch fails midway', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'MaaS Test',
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
    expect(mocks.codexAuthRollback).toHaveBeenCalledTimes(1);
  });

  it('keeps zero or one Custom instance globally active when switching instances', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'Custom Test',
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
      displayName: 'MaaS Test',
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

  it('restores one Client to its exact pre-MaaS snapshot', async () => {
    const service = new MaasService();
    vi.spyOn(service, 'getInferenceCredentials').mockResolvedValue({
      displayName: 'MaaS Test',
      endpoint: 'https://maas.example.test/v1',
      apiKey: 'secret',
    });
    const beforeMaas = {
      authProvider: 'official-api' as const,
      defaultModel: 'gpt-5',
      extraArgs: '--original',
      env: { ORIGINAL: '1' },
    };
    mocks.runtimeConfigs.codex = structuredClone(beforeMaas);

    await expect(
      service.setRuntimeBinding({ runtimeId: 'codex', platformId: 'zenmux', enabled: true })
    ).resolves.toEqual({ success: true });
    mocks.runtimeConfigs.codex = {
      ...mocks.runtimeConfigs.codex,
      defaultModel: 'changed-while-enabled',
      extraArgs: '--temporary',
      env: { TEMPORARY: '1' },
    };

    await expect(
      service.setRuntimeBinding({ runtimeId: 'codex', platformId: 'zenmux', enabled: false })
    ).resolves.toEqual({ success: true });

    expect(mocks.runtimeConfigs.codex).toEqual(beforeMaas);
    expect(mocks.settings.runtimeBindings).toEqual([]);
    expect(mocks.codexAuthEnable).toHaveBeenCalledOnce();
    expect(mocks.codexAuthDisable).toHaveBeenCalledTimes(1);
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
    mocks.runtimeConfigs = {
      codex: { authProvider: 'official-api', defaultModel: 'gpt-5' },
    };
    mocks.failRuntimeId = null;
    vi.clearAllMocks();
    mocks.codexAuthEnable.mockResolvedValue(mocks.codexAuthRollback);
    mocks.codexAuthDisable.mockResolvedValue(mocks.codexAuthRollback);
    mocks.extensionGet.mockResolvedValue({
      supported: true,
      installation: { enabled: true },
      runtime: { state: 'running' },
    });
    mocks.gatewayClear.mockResolvedValue(undefined);
    mocks.gatewayProviderId = null;
    mocks.gatewayConfigure.mockImplementation(async (configuration: { providerId: string }) => {
      mocks.gatewayProviderId = configuration.providerId;
      return mocks.gatewayRollback;
    });
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

  it('immediately republishes an edited endpoint and key for an active Codex binding', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api', defaultModel: 'gpt-5' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    mocks.runtimeConfigs.codex = {
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
      defaultModel: 'gpt-5',
    };

    const result = await new MaasService().connectPlatform({
      platformId: 'zenmux',
      displayName: 'ZenMux Production',
      endpoint: 'https://new.zenmux.example/v1',
      inferenceApiKey: 'new-inference-secret',
    });

    expect(result).toMatchObject({ success: true });
    expect(mocks.codexAuthEnable).toHaveBeenCalledWith({
      codexHome: expect.any(String),
      platformId: 'zenmux',
      displayName: 'ZenMux Production',
      gatewayBaseUrl: 'http://127.0.0.1:15721/v1',
      gatewayToken: 'local-gateway-token',
    });
    expect(mocks.gatewayConfigure).toHaveBeenCalledWith({
      providerId: 'zenmux',
      endpoint: 'https://new.zenmux.example/v1',
      apiKey: 'new-inference-secret',
    });
    expect(mocks.secrets['yoda-maas-inference-token:zenmux']).toBe('new-inference-secret');
  });

  it('rolls the key and connection back when active Codex environment publication fails', async () => {
    mocks.settings.runtimeBindings = [
      {
        runtimeId: 'codex',
        platformId: 'zenmux',
        previousAuthProvider: 'official-api',
        previousMaasPlatformId: null,
        previousConfig: { authProvider: 'official-api', defaultModel: 'gpt-5' },
        enabledAt: '2026-07-25T00:00:00.000Z',
      },
    ];
    mocks.runtimeConfigs.codex = {
      authProvider: 'yoda-maas',
      maasPlatformId: 'zenmux',
      defaultModel: 'gpt-5',
    };
    const originalSettings = structuredClone(mocks.settings);
    mocks.codexAuthEnable.mockRejectedValueOnce(new Error('environment publication failed'));

    const result = await new MaasService().connectPlatform({
      platformId: 'zenmux',
      endpoint: 'https://broken.example/v1',
      inferenceApiKey: 'replacement-secret',
    });

    expect(result).toEqual({ success: false, error: 'environment publication failed' });
    expect(mocks.settings).toEqual(originalSettings);
    expect(mocks.secrets['yoda-maas-inference-token:zenmux']).toBe('inference-secret');
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
