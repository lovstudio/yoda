import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('official model provider catalog', () => {
  it('ships dated snapshots with vendor documentation for the initial catalog', () => {
    expect(OFFICIAL_MODEL_PROVIDER_SOURCES.map((source) => source.providerId)).toEqual([
      'openai',
      'anthropic',
      'kimi',
      'google',
    ]);
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
});
