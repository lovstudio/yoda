import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOfficialModelProviderModels,
  OFFICIAL_MODEL_PROVIDER_SOURCES,
} from './official-model-provider-catalog';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock('electron', () => ({
  net: {
    fetch: mocks.fetch,
  },
}));

vi.mock('./runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getRuntimeConfig,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.COHERE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.MINIMAX_API_KEY;
});

describe('official model provider catalog', () => {
  it('ships dated snapshots with vendor documentation for the initial catalog', () => {
    expect(OFFICIAL_MODEL_PROVIDER_SOURCES.map((source) => source.providerId)).toEqual(
      expect.arrayContaining([
        'openai',
        'anthropic',
        'kimi',
        'google',
        'deepseek',
        'qwen',
        'xai',
        'mistral',
        'minimax',
        'zhipu',
        'cohere',
      ])
    );
    for (const source of OFFICIAL_MODEL_PROVIDER_SOURCES) {
      expect(source.sourceUrl).toMatch(/^https:\/\//);
      expect(source.snapshotAt).toBe('2026-07-31T00:00:00.000Z');
      expect(source.snapshotModels.length).toBeGreaterThan(0);
    }
  });

  it('uses a locally configured key and filters non-text OpenAI models', async () => {
    mocks.getRuntimeConfig.mockResolvedValue({
      env: { OPENAI_API_KEY: 'test-key' },
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-5.6-sol' }, { id: 'text-embedding-4' }, { id: 'gpt-5.6-audio' }],
      }),
    });

    await expect(fetchOfficialModelProviderModels('openai')).resolves.toEqual({
      kind: 'success',
      models: ['openai/gpt-5.6-sol'],
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      })
    );
  });

  it('keeps official API access dormant until a vendor key exists', async () => {
    await expect(fetchOfficialModelProviderModels('kimi')).resolves.toEqual({
      kind: 'credentialsMissing',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('parses Cohere model names and removes deprecated entries', async () => {
    process.env.COHERE_API_KEY = 'test-key';
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'command-a-plus-05-2026', is_deprecated: false },
          { name: 'command-r-old', is_deprecated: true },
          { name: 'embed-v4.0', is_deprecated: false },
        ],
      }),
    });

    await expect(fetchOfficialModelProviderModels('cohere')).resolves.toEqual({
      kind: 'success',
      models: ['cohere/command-a-plus-05-2026'],
    });
  });

  it('keeps only Qwen text generation models from the account catalog', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key';
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'qwen3.7-plus' }, { id: 'qwen-image-2.0' }, { id: 'qwen3-embedding-8b' }],
      }),
    });

    await expect(fetchOfficialModelProviderModels('qwen')).resolves.toEqual({
      kind: 'success',
      models: ['qwen/qwen3.7-plus'],
    });
  });

  it('keeps only MiniMax text models from the account catalog', async () => {
    process.env.MINIMAX_API_KEY = 'test-key';
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'MiniMax-M2.7' }, { id: 'MiniMax-Hailuo-2.3' }, { id: 'speech-2.8' }],
      }),
    });

    await expect(fetchOfficialModelProviderModels('minimax')).resolves.toEqual({
      kind: 'success',
      models: ['minimax/MiniMax-M2.7'],
    });
  });
});
