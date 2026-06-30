import { describe, expect, it, vi } from 'vitest';
import type { GlobalLlmModelCandidate } from '@shared/global-llm';
import { sortModelCandidatesForDisplay } from './model-discovery-service';

vi.mock('ai', () => ({
  gateway: {
    getAvailableModels: vi.fn(),
  },
}));

vi.mock('@shared/runtime-registry', () => ({
  getRuntime: vi.fn(),
}));

vi.mock('@main/core/settings/runtime-model-candidates-service', () => ({
  runtimeModelCandidatesService: {
    inferNamingModelCandidates: vi.fn(),
  },
}));

vi.mock('@main/core/settings/runtime-model-catalog', () => ({
  filterModelsForRuntime: vi.fn((_runtime: unknown, models: string[]) => models),
}));

describe('sortModelCandidatesForDisplay', () => {
  it('prefers concrete recent models over aliases and keeps mini ahead of nano', () => {
    const sorted = sortModelCandidatesForDisplay([
      candidate('chat-latest'),
      candidate('gpt-5.5-pro'),
      candidate('gpt-5.5'),
      candidate('gpt-5.4-nano'),
      candidate('gpt-5.4-mini'),
    ]);

    expect(sorted.map((model) => model.id)).toEqual([
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'chat-latest',
    ]);
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
