import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderSettings } from '@shared/app-settings';
import {
  buildModelProviderCatalog,
  ModelProviderCatalogService,
} from './model-provider-catalog-service';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listCatalog: vi.fn(),
}));

vi.mock('@main/core/maas/maas-service', () => ({
  maasService: {
    listZenmuxCatalogTextModelCandidates: mocks.listCatalog,
  },
}));

vi.mock('./settings-service', () => ({
  appSettingsService: {
    get: mocks.getSettings,
    update: mocks.updateSettings,
  },
}));

let storedSettings: ModelProviderSettings;

beforeEach(() => {
  vi.clearAllMocks();
  storedSettings = { providers: {} };
  mocks.getSettings.mockImplementation(async () => storedSettings);
  mocks.updateSettings.mockImplementation(
    async (_key: string, value: Partial<ModelProviderSettings>) => {
      storedSettings = {
        providers: {
          ...storedSettings.providers,
          ...(value.providers ?? {}),
        },
      };
    }
  );
  mocks.listCatalog.mockResolvedValue([]);
});

describe('model provider catalog', () => {
  it('groups model IDs by actual vendors instead of agent runtimes', () => {
    const result = buildModelProviderCatalog(
      [
        'openai/gpt-5.5',
        'anthropic/claude-sonnet-4.6',
        'moonshotai/kimi-k2.5',
        'mistralai/codestral-latest',
      ],
      {}
    );

    expect(result.providers.slice(0, 3).map((provider) => provider.name)).toEqual([
      'OpenAI',
      'Anthropic',
      'Kimi',
    ]);
    expect(providerModels(result, 'openai')).toEqual(['openai/gpt-5.5']);
    expect(providerModels(result, 'anthropic')).toEqual(['anthropic/claude-sonnet-4.6']);
    expect(providerModels(result, 'kimi')).toEqual(['moonshotai/kimi-k2.5']);
    expect(result.providers.some((provider) => provider.name === 'Codex')).toBe(false);
    expect(result.providers.some((provider) => provider.name === 'Claude Code')).toBe(false);
  });

  it('persists custom models under their vendor and normalizes bare IDs', async () => {
    mocks.listCatalog.mockResolvedValue(['openai/gpt-5.5']);
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

  it('maps vendor custom models to the matching client model IDs', async () => {
    storedSettings = {
      providers: {
        openai: { customModels: ['openai/gpt-5.6-codex'] },
        anthropic: { customModels: ['anthropic/claude-opus-4.7'] },
        kimi: { customModels: ['moonshotai/kimi-k2.5'] },
      },
    };
    const service = new ModelProviderCatalogService();

    await expect(service.listCustomModelsForRuntime('codex')).resolves.toEqual(['gpt-5.6-codex']);
    await expect(service.listCustomModelsForRuntime('claude')).resolves.toEqual([
      'claude-opus-4-7',
    ]);
    await expect(service.listCustomModelsForRuntime('kimi')).resolves.toEqual(['kimi-k2.5']);
  });
});

function providerModels(
  result: ReturnType<typeof buildModelProviderCatalog>,
  providerId: string
): string[] {
  return result.providers
    .find((provider) => provider.id === providerId)!
    .models.map((model) => model.id);
}
