import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderSettings } from '@shared/app-settings';
import {
  buildModelProviderCatalog,
  ModelProviderCatalogService,
} from './model-provider-catalog-service';

const mocks = vi.hoisted(() => ({
  fetchOfficial: vi.fn(),
  getSettings: vi.fn(),
  hasCredentials: vi.fn(),
  listCatalog: vi.fn(),
  updateComputed: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock('@main/core/maas/maas-service', () => ({
  maasService: {
    listZenmuxCatalogTextModelCandidates: mocks.listCatalog,
  },
}));

vi.mock('./official-model-provider-catalog', () => {
  const sources = [
    {
      providerId: 'openai',
      sourceUrl: 'https://developers.openai.com/api/docs/models',
      snapshotAt: '2026-07-31T00:00:00.000Z',
      snapshotModels: ['openai/gpt-5.6'],
    },
    {
      providerId: 'anthropic',
      sourceUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
      snapshotAt: '2026-07-31T00:00:00.000Z',
      snapshotModels: ['anthropic/claude-sonnet-5'],
    },
    {
      providerId: 'kimi',
      sourceUrl: 'https://platform.kimi.com/docs/overview',
      snapshotAt: '2026-07-31T00:00:00.000Z',
      snapshotModels: ['moonshotai/kimi-k3'],
    },
  ];
  return {
    OFFICIAL_MODEL_PROVIDER_SOURCES: sources,
    fetchOfficialModelProviderModels: mocks.fetchOfficial,
    getOfficialModelProviderSource: (providerId: string) =>
      sources.find((source) => source.providerId === providerId),
    hasOfficialModelProviderCredentials: mocks.hasCredentials,
  };
});

vi.mock('./settings-service', () => ({
  appSettingsService: {
    get: mocks.getSettings,
    update: mocks.updateSettings,
    updateComputed: mocks.updateComputed,
  },
}));

let storedSettings: ModelProviderSettings;

beforeEach(() => {
  vi.clearAllMocks();
  storedSettings = createSettings();
  mocks.getSettings.mockImplementation(async () => storedSettings);
  mocks.hasCredentials.mockResolvedValue(false);
  mocks.updateSettings.mockImplementation(
    async (_key: string, value: Partial<ModelProviderSettings>) => {
      storedSettings = {
        ...storedSettings,
        ...value,
        providers: {
          ...storedSettings.providers,
          ...(value.providers ?? {}),
        },
        catalogCache: value.catalogCache ?? storedSettings.catalogCache,
      };
    }
  );
  mocks.updateComputed.mockImplementation(
    async (_key: string, compute: (current: ModelProviderSettings) => ModelProviderSettings) => {
      storedSettings = compute(storedSettings);
      return storedSettings;
    }
  );
  mocks.listCatalog.mockResolvedValue([]);
  mocks.fetchOfficial.mockResolvedValue({ kind: 'credentialsMissing' });
});

describe('model provider catalog', () => {
  it('initializes vendor groups from traceable official snapshots', () => {
    const result = buildModelProviderCatalog(
      createSettings({
        aggregateModels: [
          'openai/gpt-5.5',
          'anthropic/claude-sonnet-4.6',
          'moonshotai/kimi-k2.5',
          'mistralai/codestral-latest',
        ],
      })
    );

    expect(result.providers.slice(0, 3).map((provider) => provider.name)).toEqual([
      'OpenAI',
      'Anthropic',
      'Kimi',
    ]);
    expect(providerModels(result, 'openai')).toEqual(
      expect.arrayContaining(['openai/gpt-5.6', 'openai/gpt-5.5'])
    );
    expect(
      result.providers
        .find((provider) => provider.id === 'openai')
        ?.models.find((model) => model.id === 'openai/gpt-5.6')?.sources
    ).toEqual(['official']);
    expect(result.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      officialSourceUrl: 'https://developers.openai.com/api/docs/models',
      updateStatus: 'snapshot',
    });
    expect(result.providers.some((provider) => provider.name === 'Codex')).toBe(false);
    expect(result.providers.some((provider) => provider.name === 'Claude Code')).toBe(false);
  });

  it('persists custom models under their vendor and normalizes bare IDs', async () => {
    const service = new ModelProviderCatalogService();

    const result = await service.updateCustomModels('openai', ['gpt-5.6-codex']);

    expect(mocks.updateSettings).toHaveBeenCalledWith('modelProviders', {
      providers: {
        openai: {
          customModels: ['openai/gpt-5.6-codex'],
        },
      },
    });
    expect(result.providers.find((provider) => provider.id === 'openai')?.customModels).toEqual([
      'openai/gpt-5.6-codex',
    ]);
  });

  it('replaces a snapshot with a successful official API refresh', async () => {
    mocks.hasCredentials.mockImplementation(async (providerId: string) => providerId === 'openai');
    mocks.fetchOfficial.mockImplementation(async (providerId: string) =>
      providerId === 'openai'
        ? { kind: 'success', models: ['openai/gpt-account-model'] }
        : { kind: 'credentialsMissing' }
    );
    const service = new ModelProviderCatalogService();

    const result = await service.refresh({ providerId: 'openai', reason: 'manual' });
    const openai = result.providers.find((provider) => provider.id === 'openai');

    expect(providerModels(result, 'openai')).toContain('openai/gpt-account-model');
    expect(providerModels(result, 'openai')).not.toContain('openai/gpt-5.6');
    expect(openai).toMatchObject({
      officialApiConfigured: true,
      updateStatus: 'current',
    });
  });

  it('keeps the last official result when a later refresh fails', async () => {
    storedSettings = createSettings({
      official: {
        openai: {
          models: ['openai/gpt-last-success'],
          fetchedAt: '2026-07-30T00:00:00.000Z',
          lastAttemptAt: '2026-07-30T00:00:00.000Z',
        },
      },
    });
    mocks.hasCredentials.mockImplementation(async (providerId: string) => providerId === 'openai');
    mocks.fetchOfficial.mockRejectedValue(new Error('request failed'));
    const service = new ModelProviderCatalogService();

    const result = await service.refresh({ providerId: 'openai', reason: 'manual' });
    const openai = result.providers.find((provider) => provider.id === 'openai');

    expect(providerModels(result, 'openai')).toContain('openai/gpt-last-success');
    expect(openai).toMatchObject({
      updateStatus: 'stale',
      updateError: 'request failed',
    });
  });

  it('keeps the cached aggregate catalog when its refresh fails', async () => {
    storedSettings = createSettings({
      aggregateModels: ['mistralai/codestral-latest'],
    });
    mocks.listCatalog.mockRejectedValue(new Error('catalog offline'));
    const service = new ModelProviderCatalogService();

    const result = await service.refresh({ providerId: 'mistral', reason: 'manual' });
    const mistral = result.providers.find((provider) => provider.id === 'mistral');

    expect(providerModels(result, 'mistral')).toContain('mistralai/codestral-latest');
    expect(mistral).toMatchObject({
      updateStatus: 'stale',
      updateError: 'catalog offline',
    });
  });

  it('runs automatic refresh only when enabled and the 24-hour interval is due', async () => {
    const service = new ModelProviderCatalogService();
    storedSettings = createSettings({ automaticUpdatesEnabled: false });

    await service.refreshAutomatically();
    expect(mocks.listCatalog).not.toHaveBeenCalled();

    storedSettings = createSettings({
      lastAutomaticRefreshAt: new Date().toISOString(),
    });
    await service.refreshAutomatically();
    expect(mocks.listCatalog).not.toHaveBeenCalled();

    storedSettings = createSettings({
      lastAutomaticRefreshAt: '2026-01-01T00:00:00.000Z',
    });
    await service.refreshAutomatically();
    expect(mocks.listCatalog).toHaveBeenCalledTimes(1);
    expect(storedSettings.lastAutomaticRefreshAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('maps vendor custom models to the matching client model IDs', async () => {
    storedSettings = createSettings({
      providers: {
        openai: { customModels: ['openai/gpt-5.6-codex'] },
        anthropic: { customModels: ['anthropic/claude-opus-4.7'] },
        kimi: { customModels: ['moonshotai/kimi-k2.5'] },
      },
    });
    const service = new ModelProviderCatalogService();

    await expect(service.listCustomModelsForRuntime('codex')).resolves.toEqual(['gpt-5.6-codex']);
    await expect(service.listCustomModelsForRuntime('claude')).resolves.toEqual([
      'claude-opus-4-7',
    ]);
    await expect(service.listCustomModelsForRuntime('kimi')).resolves.toEqual(['kimi-k2.5']);
  });
});

function createSettings(
  overrides: {
    aggregateModels?: string[];
    automaticUpdatesEnabled?: boolean;
    lastAutomaticRefreshAt?: string | null;
    official?: ModelProviderSettings['catalogCache']['official'];
    providers?: ModelProviderSettings['providers'];
  } = {}
): ModelProviderSettings {
  return {
    automaticUpdatesEnabled: overrides.automaticUpdatesEnabled ?? true,
    lastAutomaticRefreshAt: overrides.lastAutomaticRefreshAt ?? null,
    providers: overrides.providers ?? {},
    catalogCache: {
      official: overrides.official ?? {},
      aggregate: {
        models: overrides.aggregateModels ?? [],
        fetchedAt: null,
        lastAttemptAt: null,
      },
    },
  };
}

function providerModels(
  result: ReturnType<typeof buildModelProviderCatalog>,
  providerId: string
): string[] {
  return result.providers
    .find((provider) => provider.id === providerId)!
    .models.map((model) => model.id);
}
