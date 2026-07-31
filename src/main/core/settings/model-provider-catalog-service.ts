import type { ModelProviderSettings } from '@shared/app-settings';
import {
  getModelProviderDefinition,
  isReservedModelProviderId,
  MAX_CUSTOM_MODEL_PROVIDERS,
  MAX_CUSTOM_MODELS_PER_PROVIDER,
  MODEL_PROVIDER_AUTO_REFRESH_INTERVAL_MS,
  MODEL_PROVIDER_DEFINITIONS,
  modelProviderIdsForRuntime,
  normalizeCustomModelProviderId,
  normalizeModelIdForProvider,
  resolveModelProvider,
  toRuntimeModelId,
  type CreateCustomModelProviderInput,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogItem,
  type ModelProviderCatalogResult,
  type ModelProviderCatalogSource,
} from '@shared/model-provider-catalog';
import type { RuntimeId } from '@shared/runtime-registry';
import { maasService } from '@main/core/maas/maas-service';
import { log } from '@main/lib/logger';
import { normalizeModelCandidates } from './model-candidate-parser';
import {
  fetchOfficialModelProviderModels,
  getOfficialModelProviderSource,
  hasOfficialModelProviderCredentials,
  OFFICIAL_MODEL_PROVIDER_SOURCES,
  supportsOfficialModelProviderApi,
} from './official-model-provider-catalog';
import { appSettingsService } from './settings-service';

type MutableProviderGroup = {
  id: string;
  name: string;
  custom: boolean;
  models: Map<string, Set<ModelProviderCatalogSource>>;
  customModels: string[];
};

type RefreshReason = 'automatic' | 'manual';

export class ModelProviderCatalogService {
  async list(): Promise<ModelProviderCatalogResult> {
    const settings = await appSettingsService.get('modelProviders');
    return this.buildResult(settings);
  }

  async refresh(
    args: {
      providerId?: string;
      reason?: RefreshReason;
    } = {}
  ): Promise<ModelProviderCatalogResult> {
    const reason = args.reason ?? 'manual';
    const providerId = args.providerId?.trim().toLowerCase();
    const targetSources = providerId
      ? OFFICIAL_MODEL_PROVIDER_SOURCES.filter((source) => source.providerId === providerId)
      : OFFICIAL_MODEL_PROVIDER_SOURCES;
    const now = new Date().toISOString();
    const current = await appSettingsService.get('modelProviders');
    const officialUpdates: ModelProviderSettings['catalogCache']['official'] = {};

    await Promise.all(
      targetSources.map(async (source) => {
        const previous = current.catalogCache.official[source.providerId] ?? {
          models: [],
          fetchedAt: null,
          lastAttemptAt: null,
        };
        try {
          const result = await fetchOfficialModelProviderModels(source.providerId);
          if (result.kind === 'credentialsMissing') return;
          officialUpdates[source.providerId] = {
            models: normalizeCatalogModelIds(result.models),
            fetchedAt: now,
            lastAttemptAt: now,
          };
        } catch (cause) {
          const error = summarizeRefreshError(cause);
          officialUpdates[source.providerId] = {
            ...previous,
            lastAttemptAt: now,
            error,
          };
          log.warn('model-provider-catalog: official refresh failed', {
            providerId: source.providerId,
            error,
          });
        }
      })
    );

    let aggregate = current.catalogCache.aggregate;
    try {
      const models = await maasService.listZenmuxCatalogTextModelCandidates(true);
      aggregate = {
        models: normalizeCatalogModelIds(models),
        fetchedAt: now,
        lastAttemptAt: now,
      };
    } catch (cause) {
      const error = summarizeRefreshError(cause);
      aggregate = {
        ...aggregate,
        lastAttemptAt: now,
        error,
      };
      log.warn('model-provider-catalog: aggregate refresh failed', { error });
    }

    const next = await appSettingsService.updateComputed('modelProviders', (latest) => ({
      ...latest,
      lastAutomaticRefreshAt: reason === 'automatic' ? now : latest.lastAutomaticRefreshAt,
      catalogCache: {
        official: {
          ...latest.catalogCache.official,
          ...officialUpdates,
        },
        aggregate,
      },
    }));
    return this.buildResult(next);
  }

  async refreshAutomatically(): Promise<ModelProviderCatalogResult> {
    const settings = await appSettingsService.get('modelProviders');
    if (!settings.automaticUpdatesEnabled || !isAutomaticRefreshDue(settings)) {
      return this.buildResult(settings);
    }
    return this.refresh({ reason: 'automatic' });
  }

  async setAutomaticUpdatesEnabled(enabled: boolean): Promise<ModelProviderCatalogResult> {
    await appSettingsService.update('modelProviders', {
      automaticUpdatesEnabled: enabled,
    });
    return this.list();
  }

  async updateCustomModels(
    providerId: string,
    customModels: string[]
  ): Promise<ModelProviderCatalogResult> {
    const normalizedProviderId = providerId.trim().toLowerCase();
    if (!normalizedProviderId) throw new Error('Model provider is required.');

    const normalized = normalizeCustomModels(normalizedProviderId, customModels, true);
    await appSettingsService.updateComputed('modelProviders', (latest) => ({
      ...latest,
      providers: {
        ...latest.providers,
        [normalizedProviderId]: {
          ...latest.providers[normalizedProviderId],
          customModels: normalized,
        },
      },
    }));

    return this.list();
  }

  async createCustomProvider(
    input: CreateCustomModelProviderInput
  ): Promise<ModelProviderCatalogResult> {
    const providerId = normalizeCustomModelProviderId(input.id);
    const name = input.name.trim();
    if (!providerId) throw new Error('Custom model provider ID is invalid.');
    if (!name || name.length > 60) throw new Error('Custom model provider name is invalid.');
    if (isReservedModelProviderId(providerId)) {
      throw new Error('This model provider ID is reserved.');
    }

    const customModels = input.initialModel?.trim()
      ? normalizeCustomModels(providerId, [input.initialModel], true)
      : [];
    await appSettingsService.updateComputed('modelProviders', (latest) => {
      if (latest.providers[providerId]) {
        throw new Error('A model provider with this ID already exists.');
      }
      const customProviderCount = Object.values(latest.providers).filter(
        (provider) => provider.name !== undefined
      ).length;
      if (customProviderCount >= MAX_CUSTOM_MODEL_PROVIDERS) {
        throw new Error('The custom model provider limit has been reached.');
      }
      return {
        ...latest,
        providers: {
          ...latest.providers,
          [providerId]: {
            name,
            customModels,
          },
        },
      };
    });
    return this.list();
  }

  async deleteCustomProvider(providerId: string): Promise<ModelProviderCatalogResult> {
    const normalizedProviderId = normalizeCustomModelProviderId(providerId);
    if (!normalizedProviderId) throw new Error('Custom model provider ID is invalid.');

    await appSettingsService.updateComputed('modelProviders', (latest) => {
      if (!latest.providers[normalizedProviderId]?.name) {
        throw new Error('Custom model provider was not found.');
      }
      const providers = { ...latest.providers };
      delete providers[normalizedProviderId];
      return { ...latest, providers };
    });
    return this.list();
  }

  async listCustomModelsForRuntime(runtimeId: RuntimeId): Promise<string[]> {
    const settings = await appSettingsService.get('modelProviders');
    const models: string[] = [];

    for (const providerId of modelProviderIdsForRuntime(runtimeId)) {
      const customModels = settings.providers[providerId]?.customModels ?? [];
      for (const model of normalizeCustomModels(providerId, customModels)) {
        models.push(toRuntimeModelId(providerId, model));
      }
    }

    return normalizeModelCandidates(models);
  }

  private async buildResult(settings: ModelProviderSettings): Promise<ModelProviderCatalogResult> {
    const credentialPairs = await Promise.all(
      OFFICIAL_MODEL_PROVIDER_SOURCES.map(
        async (source) =>
          [source.providerId, await hasOfficialModelProviderCredentials(source.providerId)] as const
      )
    );
    return buildModelProviderCatalog(
      settings,
      new Set(credentialPairs.filter(([, value]) => value).map(([id]) => id))
    );
  }
}

export function buildModelProviderCatalog(
  settings: ModelProviderSettings,
  configuredOfficialProviders: ReadonlySet<string> = new Set()
): ModelProviderCatalogResult {
  const groups = new Map<string, MutableProviderGroup>();

  for (const provider of MODEL_PROVIDER_DEFINITIONS) {
    groups.set(provider.id, {
      id: provider.id,
      name: provider.name,
      custom: false,
      models: new Map(),
      customModels: normalizeCustomModels(
        provider.id,
        settings.providers[provider.id]?.customModels ?? []
      ),
    });
  }

  for (const [providerId, providerSettings] of Object.entries(settings.providers)) {
    if (groups.has(providerId)) continue;
    groups.set(providerId, {
      id: providerId,
      name:
        providerSettings.name ??
        getModelProviderDefinition(providerId)?.name ??
        formatProviderName(providerId),
      custom: providerSettings.name !== undefined,
      models: new Map(),
      customModels: normalizeCustomModels(providerId, providerSettings.customModels),
    });
  }

  for (const source of OFFICIAL_MODEL_PROVIDER_SOURCES) {
    const cached = settings.catalogCache.official[source.providerId];
    const models = cached?.fetchedAt ? cached.models : source.snapshotModels;
    addModels(groups, models, 'official');
  }
  addModels(groups, settings.catalogCache.aggregate.models, 'aggregate');

  for (const group of groups.values()) {
    for (const modelId of group.customModels) addModel(group, modelId, 'custom');
  }

  const knownOrder = new Map<string, number>(
    MODEL_PROVIDER_DEFINITIONS.map((provider, index) => [provider.id, index])
  );
  const providers = [...groups.values()].map((group) =>
    toCatalogGroup(group, settings, configuredOfficialProviders.has(group.id))
  );
  providers.sort((left, right) => {
    const leftOrder = knownOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = knownOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });

  return {
    providers,
    fetchedAt: new Date().toISOString(),
    automaticUpdatesEnabled: settings.automaticUpdatesEnabled,
    lastAutomaticRefreshAt: settings.lastAutomaticRefreshAt,
    nextAutomaticRefreshAt: settings.automaticUpdatesEnabled
      ? nextAutomaticRefreshAt(settings.lastAutomaticRefreshAt)
      : null,
    ...(settings.catalogCache.aggregate.error
      ? { error: settings.catalogCache.aggregate.error }
      : {}),
  };
}

function addModels(
  groups: Map<string, MutableProviderGroup>,
  models: readonly string[],
  source: ModelProviderCatalogSource
): void {
  for (const modelId of normalizeCatalogModelIds(models)) {
    const provider = resolveModelProvider(modelId);
    if (!provider) continue;
    const group = groups.get(provider.id) ?? {
      id: provider.id,
      name: provider.name,
      custom: false,
      models: new Map<string, Set<ModelProviderCatalogSource>>(),
      customModels: [],
    };
    addModel(group, modelId, source);
    groups.set(provider.id, group);
  }
}

function addModel(
  group: MutableProviderGroup,
  modelId: string,
  source: ModelProviderCatalogSource
): void {
  const sources = group.models.get(modelId) ?? new Set<ModelProviderCatalogSource>();
  sources.add(source);
  group.models.set(modelId, sources);
}

function normalizeCustomModels(
  providerId: string,
  models: readonly string[],
  strict = false
): string[] {
  if (strict && models.length > MAX_CUSTOM_MODELS_PER_PROVIDER) {
    throw new Error(`A model provider can have up to ${MAX_CUSTOM_MODELS_PER_PROVIDER} models.`);
  }
  const normalized: string[] = [];
  for (const model of models) {
    const modelId = normalizeModelIdForProvider(providerId, model);
    if (!modelId || !isValidCatalogModelId(modelId)) {
      if (strict) throw new Error(`Model ID does not belong to provider "${providerId}".`);
      continue;
    }
    normalized.push(modelId);
  }
  return normalizeModelCandidates(normalized).slice(0, MAX_CUSTOM_MODELS_PER_PROVIDER);
}

function normalizeCatalogModelIds(models: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const model of models) {
    const modelId = model.trim();
    if (!isValidCatalogModelId(modelId) || normalized.includes(modelId)) {
      continue;
    }
    normalized.push(modelId);
  }
  return normalized;
}

function isValidCatalogModelId(modelId: string): boolean {
  return modelId.length >= 2 && modelId.length <= 100 && /^[a-z0-9][a-z0-9._:/+-]*$/i.test(modelId);
}

function toCatalogGroup(
  group: MutableProviderGroup,
  settings: ModelProviderSettings,
  officialApiConfigured: boolean
): ModelProviderCatalogGroup {
  const source = getOfficialModelProviderSource(group.id);
  const cached = settings.catalogCache.official[group.id];
  const models: ModelProviderCatalogItem[] = [...group.models.entries()].map(([id, sourceSet]) => ({
    id,
    custom: sourceSet.has('custom'),
    sources: [...sourceSet].sort((left, right) => sourceOrder(left) - sourceOrder(right)),
  }));
  models.sort(
    (left, right) => Number(right.custom) - Number(left.custom) || left.id.localeCompare(right.id)
  );

  const updateStatus = group.custom
    ? 'customOnly'
    : source
      ? cached?.fetchedAt
        ? cached.error
          ? 'stale'
          : 'current'
        : 'snapshot'
      : settings.catalogCache.aggregate.error
        ? 'stale'
        : 'aggregateOnly';

  return {
    id: group.id,
    name: group.name,
    custom: group.custom,
    models,
    customModels: group.customModels,
    officialSourceUrl: source?.sourceUrl ?? null,
    officialSnapshotAt: source?.snapshotAt ?? null,
    officialFetchedAt: cached?.fetchedAt ?? null,
    lastUpdateAttemptAt:
      cached?.lastAttemptAt ?? (source ? null : settings.catalogCache.aggregate.lastAttemptAt),
    officialApiSupported: supportsOfficialModelProviderApi(group.id),
    officialApiConfigured,
    updateStatus,
    ...(cached?.error
      ? { updateError: cached.error }
      : !source && settings.catalogCache.aggregate.error
        ? { updateError: settings.catalogCache.aggregate.error }
        : {}),
  };
}

function sourceOrder(source: ModelProviderCatalogSource): number {
  return source === 'official' ? 0 : source === 'aggregate' ? 1 : 2;
}

function isAutomaticRefreshDue(settings: ModelProviderSettings): boolean {
  if (!settings.lastAutomaticRefreshAt) return true;
  const lastRefresh = Date.parse(settings.lastAutomaticRefreshAt);
  return (
    !Number.isFinite(lastRefresh) ||
    Date.now() - lastRefresh >= MODEL_PROVIDER_AUTO_REFRESH_INTERVAL_MS
  );
}

function nextAutomaticRefreshAt(lastAutomaticRefreshAt: string | null): string | null {
  if (!lastAutomaticRefreshAt) return null;
  const lastRefresh = Date.parse(lastAutomaticRefreshAt);
  if (!Number.isFinite(lastRefresh)) return null;
  return new Date(lastRefresh + MODEL_PROVIDER_AUTO_REFRESH_INTERVAL_MS).toISOString();
}

function summarizeRefreshError(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return 'Official model API request timed out.';
  }
  return cause instanceof Error ? cause.message : String(cause);
}

function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const modelProviderCatalogService = new ModelProviderCatalogService();
