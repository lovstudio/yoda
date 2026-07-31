import type { RuntimeCustomConfig } from '@shared/app-settings';
import type {
  AgentModelCandidateCacheEntry,
  AgentModelCandidateInferenceResult,
  AgentModelCandidateItem,
  AgentModelCandidateProviderSettings,
  RuntimeModelCandidateCacheSource,
  RuntimeModelCandidateSource,
} from '@shared/runtime-model-candidates';
import {
  getRuntime,
  RUNTIMES,
  type RuntimeDefinition,
  type RuntimeId,
} from '@shared/runtime-registry';
import { maasService } from '@main/core/maas/maas-service';
import { log } from '@main/lib/logger';
import { normalizeModelCandidates } from './model-candidate-parser';
import {
  filterModelsForRuntime,
  sanitizeCachedModelIdsForRuntime,
  sanitizeCatalogEntriesForRuntime,
} from './runtime-model-catalog';
import { runtimeOverrideSettings } from './runtime-settings-service';
import { appSettingsService } from './settings-service';

const MODEL_CANDIDATE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type SourceResult = {
  source: RuntimeModelCandidateCacheSource;
  models: string[];
  error?: string;
};

const CATALOG_SOURCE: RuntimeModelCandidateCacheSource = 'catalog';
const SOURCE_ORDER: RuntimeModelCandidateCacheSource[] = [
  'catalog',
  'zenmux',
  'officialApi',
  'docs',
  'cli',
];

export class RuntimeModelCandidatesService {
  async inferNamingModelCandidates(
    runtimeId: RuntimeId,
    args: { forceRefresh?: boolean } = {}
  ): Promise<AgentModelCandidateInferenceResult> {
    const provider = getRuntime(runtimeId);
    const [settings, providerConfig] = await Promise.all([
      appSettingsService.get('runtimeModelCandidates'),
      runtimeOverrideSettings.getItem(runtimeId),
    ]);
    const existingSettings = normalizeProviderModelSettings(settings.runtimes[runtimeId]);
    const customModels = normalizeModelCandidates(providerConfig?.customModels ?? []);
    const existingEntries = provider
      ? sanitizeCatalogEntriesForRuntime(provider, existingSettings.sources)
      : existingSettings.sources;
    const existingHiddenModels = provider
      ? sanitizeCachedModelIdsForRuntime(provider, existingSettings.hiddenModels)
      : existingSettings.hiddenModels;
    const freshEntries = existingEntries.filter(isFreshEntry);

    if (!args.forceRefresh && freshEntries.length > 0) {
      return buildInferenceResult(
        runtimeId,
        freshEntries,
        existingHiddenModels,
        customModels,
        true
      );
    }

    if (!provider) {
      return buildInferenceResult(
        runtimeId,
        existingEntries,
        existingHiddenModels,
        customModels,
        true
      );
    }

    const refreshedSettings = await this.refreshCandidates(
      provider,
      !!args.forceRefresh,
      existingSettings
    );
    const refreshedEntries = refreshedSettings.sources;
    const refreshedHiddenModels = sanitizeCachedModelIdsForRuntime(
      provider,
      refreshedSettings.hiddenModels
    );
    if (refreshedEntries.length > 0) {
      return buildInferenceResult(
        runtimeId,
        refreshedEntries,
        refreshedHiddenModels,
        customModels,
        false
      );
    }

    if (existingEntries.length > 0) {
      return buildInferenceResult(
        runtimeId,
        existingEntries,
        existingHiddenModels,
        customModels,
        true
      );
    }

    return buildInferenceResult(
      runtimeId,
      refreshedEntries,
      refreshedHiddenModels,
      customModels,
      false
    );
  }

  async updateModelCandidatePreferences(
    runtimeId: RuntimeId,
    args: {
      hiddenModels?: string[];
      preferredNamingModel?: string | null;
      customModels?: string[];
    }
  ): Promise<AgentModelCandidateInferenceResult> {
    const [settings, providerConfig] = await Promise.all([
      appSettingsService.get('runtimeModelCandidates'),
      runtimeOverrideSettings.getItem(runtimeId),
    ]);
    const current = normalizeProviderModelSettings(settings.runtimes[runtimeId]);
    const currentCustomModels = normalizeModelCandidates(providerConfig?.customModels ?? []);
    const customModels =
      args.customModels === undefined
        ? currentCustomModels
        : normalizeModelCandidates(args.customModels);
    const preferredNamingModel = args.preferredNamingModel?.trim() ?? '';
    const hiddenModels =
      args.hiddenModels === undefined
        ? current.hiddenModels
        : normalizeModelCandidates(args.hiddenModels);
    const newlyAddedCustomModels = customModels.filter(
      (model) => !currentCustomModels.includes(model)
    );
    const modelsToShow = new Set([
      ...newlyAddedCustomModels,
      ...(preferredNamingModel ? [preferredNamingModel] : []),
    ]);
    const nextHiddenModels = hiddenModels.filter((model) => !modelsToShow.has(model));

    const writes: Promise<void>[] = [
      appSettingsService.update('runtimeModelCandidates', {
        runtimes: {
          [runtimeId]: {
            sources: current.sources,
            hiddenModels: nextHiddenModels,
          },
        },
      }),
    ];

    if (args.preferredNamingModel !== undefined || args.customModels !== undefined) {
      const nextConfig: RuntimeCustomConfig = { ...(providerConfig ?? {}) };
      if (preferredNamingModel) {
        nextConfig.namingModel = preferredNamingModel;
      } else if (args.preferredNamingModel !== undefined) {
        delete nextConfig.namingModel;
      }
      if (customModels.length > 0) {
        nextConfig.customModels = customModels;
      } else {
        delete nextConfig.customModels;
      }
      writes.push(runtimeOverrideSettings.updateItem(runtimeId, nextConfig));
    }
    await Promise.all(writes);

    return this.inferNamingModelCandidates(runtimeId);
  }

  async refreshStartupModelCatalog(): Promise<void> {
    const settings = await appSettingsService.get('runtimeModelCandidates');
    const runtimes: Partial<Record<RuntimeId, AgentModelCandidateProviderSettings>> = {};

    let catalogModels: string[] = [];
    try {
      catalogModels = await maasService.listZenmuxCatalogTextModelCandidates(true);
    } catch (error) {
      log.warn('runtime-model-candidates-service: startup model catalog refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (catalogModels.length === 0) return;

    for (const provider of RUNTIMES) {
      const current = normalizeProviderModelSettings(settings.runtimes[provider.id]);
      runtimes[provider.id] = {
        sources: [
          toCacheEntry({
            source: CATALOG_SOURCE,
            models: filterModelsForRuntime(provider, catalogModels),
          }),
        ],
        hiddenModels: current.hiddenModels,
      };
    }

    if (Object.keys(runtimes).length === 0) return;
    await appSettingsService.update('runtimeModelCandidates', { runtimes });
  }

  private async refreshCandidates(
    provider: RuntimeDefinition,
    forceRefresh: boolean,
    current: AgentModelCandidateProviderSettings
  ): Promise<AgentModelCandidateProviderSettings> {
    const result = await inferSource(CATALOG_SOURCE, () =>
      inferFromCatalog(provider, forceRefresh)
    );
    const entries = [toCacheEntry(result)];

    await appSettingsService.update('runtimeModelCandidates', {
      runtimes: {
        [provider.id]: {
          sources: entries,
          hiddenModels: current.hiddenModels,
        },
      },
    });

    return {
      sources: entries,
      hiddenModels: current.hiddenModels,
    };
  }
}

async function inferSource(
  source: RuntimeModelCandidateCacheSource,
  load: () => Promise<string[]>
): Promise<SourceResult> {
  try {
    return { source, models: normalizeModelCandidates(await load()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.debug('runtime-model-candidates-service: source failed', { source, error: message });
    return { source, models: [], error: message };
  }
}

function toCacheEntry(result: SourceResult): AgentModelCandidateCacheEntry {
  const fetchedAt = new Date();
  return {
    source: result.source,
    models: result.models,
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + MODEL_CANDIDATE_CACHE_TTL_MS).toISOString(),
    ...(result.error ? { error: result.error } : {}),
  };
}

function sortSourceEntries(
  entries: readonly AgentModelCandidateCacheEntry[]
): AgentModelCandidateCacheEntry[] {
  return [...entries].sort((left, right) => {
    const leftIndex = SOURCE_ORDER.indexOf(left.source);
    const rightIndex = SOURCE_ORDER.indexOf(right.source);
    return leftIndex - rightIndex;
  });
}

function isFreshEntry(entry: AgentModelCandidateCacheEntry): boolean {
  const expiresAt = Date.parse(entry.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function normalizeProviderModelSettings(
  settings: AgentModelCandidateProviderSettings | AgentModelCandidateCacheEntry[] | undefined
): AgentModelCandidateProviderSettings {
  if (Array.isArray(settings)) {
    return {
      sources: normalizeCatalogSources(settings),
      hiddenModels: [],
    };
  }
  return {
    sources: normalizeCatalogSources(settings?.sources ?? []),
    hiddenModels: normalizeModelCandidates(settings?.hiddenModels ?? []),
  };
}

function normalizeCatalogSources(
  sources: readonly AgentModelCandidateCacheEntry[]
): AgentModelCandidateCacheEntry[] {
  return sources.filter(isCatalogEntry).map((entry) => ({
    ...entry,
    source: CATALOG_SOURCE,
  }));
}

function isCatalogEntry(entry: AgentModelCandidateCacheEntry): boolean {
  return entry.source === CATALOG_SOURCE;
}

function buildInferenceResult(
  runtimeId: RuntimeId,
  sources: readonly AgentModelCandidateCacheEntry[],
  hiddenModels: readonly string[],
  customModels: readonly string[],
  cached: boolean
): AgentModelCandidateInferenceResult {
  const sortedSources = sortSourceEntries(sources);
  const normalizedCustomModels = normalizeModelCandidates(customModels);
  const models = buildModelItems(sortedSources, hiddenModels, normalizedCustomModels);
  return {
    runtimeId,
    models,
    candidates: models.filter((model) => model.visible).map((model) => model.id),
    sources: sortedSources,
    hiddenModels: normalizeModelCandidates(hiddenModels),
    customModels: normalizedCustomModels,
    cached,
  };
}

function buildModelItems(
  entries: readonly AgentModelCandidateCacheEntry[],
  hiddenModels: readonly string[],
  customModels: readonly string[]
): AgentModelCandidateItem[] {
  const hidden = new Set(normalizeModelCandidates(hiddenModels));
  const sourceByModel = new Map<string, RuntimeModelCandidateSource[]>();

  for (const model of normalizeModelCandidates(customModels)) {
    sourceByModel.set(model, ['custom']);
  }

  for (const entry of entries) {
    for (const model of normalizeModelCandidates(entry.models)) {
      const sources = sourceByModel.get(model) ?? [];
      if (!sources.includes(entry.source)) sources.push(entry.source);
      sourceByModel.set(model, sources);
    }
  }

  return normalizeModelCandidates([...sourceByModel.keys()]).map((model) => ({
    id: model,
    visible: !hidden.has(model),
    sources: sourceByModel.get(model) ?? [],
  }));
}

async function inferFromCatalog(
  provider: RuntimeDefinition,
  forceRefresh: boolean
): Promise<string[]> {
  const models = await maasService.listZenmuxCatalogTextModelCandidates(forceRefresh);
  if (models.length === 0) return [];

  return filterModelsForRuntime(provider, models);
}

export const runtimeModelCandidatesService = new RuntimeModelCandidatesService();
