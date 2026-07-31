import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRuntime } from '@shared/runtime-registry';
import { extractModelCandidatesFromText, hasExplicitModelList } from './model-candidate-parser';
import {
  filterModelsForRuntime,
  sanitizeCachedModelIdsForRuntime,
  sanitizeCatalogEntriesForRuntime,
} from './runtime-model-catalog';

const serviceMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(async () => undefined),
  getRuntimeConfig: vi.fn(),
  updateRuntimeConfig: vi.fn<(id: string, config: Record<string, unknown>) => Promise<void>>(
    async () => undefined
  ),
  listCatalog: vi.fn(async () => [] as string[]),
}));

vi.mock('@main/core/maas/maas-service', () => ({
  maasService: {
    listZenmuxCatalogTextModelCandidates: serviceMocks.listCatalog,
  },
}));

vi.mock('./settings-service', () => ({
  appSettingsService: {
    get: serviceMocks.getSettings,
    update: serviceMocks.updateSettings,
  },
}));

vi.mock('./runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: serviceMocks.getRuntimeConfig,
    updateItem: serviceMocks.updateRuntimeConfig,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractModelCandidatesFromText', () => {
  it('extracts candidates from model lists', () => {
    const output = `
      Usage: agent run [options]
      Available models: tiny, balanced-2, vendor/family-small.
    `;

    expect(extractModelCandidatesFromText(output)).toEqual([
      'tiny',
      'balanced-2',
      'vendor/family-small',
    ]);
  });

  it('extracts quoted aliases in model context', () => {
    const output = `Use --model "quick" to select the low-latency model.`;

    expect(extractModelCandidatesFromText(output)).toEqual(['quick']);
  });

  it('ignores non-model command help text', () => {
    const output = `Usage: agent run --color never --sandbox read-only --format json`;

    expect(extractModelCandidatesFromText(output)).toEqual([]);
  });

  it('ignores model examples that are not model lists', () => {
    const output = `
      --model <model> Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a model's full name (e.g. 'claude-sonnet-4-6').
    `;

    expect(hasExplicitModelList(output)).toBe(false);
    expect(extractModelCandidatesFromText(output)).toEqual([]);
  });

  it('keeps short official model ids', () => {
    const output = `Available models: o3, o4-mini, gpt-5-mini.`;

    expect(extractModelCandidatesFromText(output)).toEqual(['o3', 'o4-mini', 'gpt-5-mini']);
  });
});

describe('provider model catalog mapping', () => {
  it('maps public catalog ids to Claude model ids', () => {
    const provider = getRuntime('claude');
    expect(provider).toBeDefined();

    expect(
      filterModelsForRuntime(provider!, [
        'anthropic/claude-sonnet-4.6',
        'openai/gpt-5.5',
        'claude-opus-4.8',
      ])
    ).toEqual(['claude-sonnet-4-6', 'claude-opus-4-8']);
  });

  it('prefers unprefixed official Claude model ids over equivalent prefixed ids', () => {
    const provider = getRuntime('claude');
    expect(provider).toBeDefined();

    expect(
      filterModelsForRuntime(provider!, [
        'anthropic/claude-opus-4.8',
        'claude-opus-4-8',
        'anthropic/claude-sonnet-4.6',
      ])
    ).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
  });

  it('sanitizes cached Claude catalog ids to Claude Code official ids', () => {
    const provider = getRuntime('claude');
    expect(provider).toBeDefined();

    expect(
      sanitizeCachedModelIdsForRuntime(provider!, [
        'anthropic/claude-opus-4.8',
        'claude-sonnet-4.6',
        'openai/gpt-5.5',
      ])
    ).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
  });

  it('maps public catalog ids to Codex model ids', () => {
    const provider = getRuntime('codex');
    expect(provider).toBeDefined();

    expect(
      filterModelsForRuntime(provider!, [
        'openai/gpt-5.5',
        'anthropic/claude-sonnet-4.6',
        'gpt-5-codex',
      ])
    ).toEqual(['gpt-5.5', 'gpt-5-codex']);
  });

  it('drops legacy source cache and sanitizes cached catalog models', () => {
    const provider = getRuntime('claude');
    expect(provider).toBeDefined();
    const fetchedAt = '2026-06-07T00:00:00.000Z';
    const expiresAt = '2026-06-14T00:00:00.000Z';

    const entries = sanitizeCatalogEntriesForRuntime(provider!, [
      {
        source: 'zenmux',
        models: ['anthropic/claude-haiku-4.5'],
        fetchedAt,
        expiresAt,
      },
      {
        source: 'cli',
        models: ['sonnet'],
        fetchedAt,
        expiresAt,
      },
      {
        source: 'catalog',
        models: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.5', 'claude-opus-4.8'],
        fetchedAt,
        expiresAt,
      },
    ]);

    expect(entries).toEqual([
      {
        source: 'catalog',
        models: ['claude-sonnet-4-6', 'claude-opus-4-8'],
        fetchedAt,
        expiresAt,
      },
    ]);
  });
});
