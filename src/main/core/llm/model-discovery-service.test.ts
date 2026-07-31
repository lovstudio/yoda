import { describe, expect, it, vi } from 'vitest';
import type { GlobalLlmModelCandidate } from '@shared/global-llm';
import { discoverGlobalLlmModels, sortModelCandidatesForDisplay } from './model-discovery-service';

const mocks = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
  getRuntime: vi.fn(),
  inferNamingModelCandidates: vi.fn(),
  listCustomModelsForRuntime: vi.fn(),
}));

vi.mock('ai', () => ({
  gateway: {
    getAvailableModels: mocks.getAvailableModels,
  },
}));

vi.mock('@shared/runtime-registry', () => ({
  getRuntime: mocks.getRuntime,
}));

vi.mock('@main/core/settings/runtime-model-candidates-service', () => ({
  runtimeModelCandidatesService: {
    inferNamingModelCandidates: mocks.inferNamingModelCandidates,
  },
}));

vi.mock('@main/core/settings/model-provider-catalog-service', () => ({
  modelProviderCatalogService: {
    listCustomModelsForRuntime: mocks.listCustomModelsForRuntime,
  },
}));

vi.mock('@main/core/settings/runtime-model-catalog', () => ({
  filterModelsForRuntime: vi.fn((_runtime: unknown, models: string[]) => models),
}));

describe('sortModelCandidatesForDisplay', () => {
  it('prefers recent concrete variants over aliases and repeated base models', () => {
    const sorted = sortModelCandidatesForDisplay([
      candidate('chat-latest'),
      candidate('gpt-5.5-pro'),
      candidate('gpt-5.5'),
      candidate('gpt-5.4-pro'),
      candidate('gpt-5.4'),
      candidate('gpt-5.4-nano'),
      candidate('gpt-5.4-mini'),
    ]);

    expect(sorted.map((model) => model.id)).toEqual([
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-5.4-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.4',
      'chat-latest',
    ]);
  });
});

describe('discoverGlobalLlmModels', () => {
  it('keeps custom models visible and identifies their source when catalogs are full', async () => {
    mocks.getRuntime.mockReturnValue(undefined);
    mocks.listCustomModelsForRuntime.mockResolvedValue(['special-model']);
    mocks.getAvailableModels.mockResolvedValue({
      models: Array.from({ length: 45 }, (_, index) => ({
        id: `gateway/model-${index + 1}`,
        name: null,
        description: null,
      })),
    });
    mocks.inferNamingModelCandidates.mockResolvedValue({
      runtimeId: 'codex',
      models: [
        {
          id: 'gpt-5.5',
          visible: true,
          sources: ['catalog'],
        },
      ],
      candidates: ['gpt-5.5'],
      sources: [],
      hiddenModels: [],
      cached: true,
    });

    const result = await discoverGlobalLlmModels({
      runtimeId: 'codex',
      authProvider: 'official-subscription',
    });

    expect(result.models).toHaveLength(40);
    expect(result.models[0]).toMatchObject({
      id: 'special-model',
      sources: ['custom'],
    });
    expect(result.sources.find((source) => source.source === 'custom')).toMatchObject({
      ok: true,
      modelCount: 1,
    });
  });
});

function candidate(id: string): GlobalLlmModelCandidate {
  return {
    id,
    name: null,
    description: null,
    sources: ['runtimeCatalog'],
  };
}
