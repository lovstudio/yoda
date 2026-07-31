import {
  getModelProviderDefinition,
  MAX_CUSTOM_MODELS_PER_PROVIDER,
  MODEL_PROVIDER_DEFINITIONS,
  modelProviderIdsForRuntime,
  normalizeModelIdForProvider,
  resolveModelProvider,
  toRuntimeModelId,
  type ModelProviderCatalogGroup,
  type ModelProviderCatalogItem,
  type ModelProviderCatalogResult,
} from '@shared/model-provider-catalog';
import type { RuntimeId } from '@shared/runtime-registry';
import { maasService } from '@main/core/maas/maas-service';
import { normalizeModelCandidates } from './model-candidate-parser';
import { appSettingsService } from './settings-service';

type MutableProviderGroup = {
  id: string;
  name: string;
  catalogModels: Set<string>;
  customModels: string[];
};

export class ModelProviderCatalogService {
  async list(args: { forceRefresh?: boolean } = {}): Promise<ModelProviderCatalogResult> {
    const settings = await appSettingsService.get('modelProviders');
    let catalogModels: string[] = [];
    let error: string | undefined;

    try {
      catalogModels = await maasService.listZenmuxCatalogTextModelCandidates(!!args.forceRefresh);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }

    return buildModelProviderCatalog(catalogModels, settings.providers, error);
  }

  async updateCustomModels(
    providerId: string,
    customModels: string[]
  ): Promise<ModelProviderCatalogResult> {
    const normalizedProviderId = providerId.trim().toLowerCase();
    if (!normalizedProviderId) throw new Error('Model provider is required.');

    const normalized = normalizeCustomModels(normalizedProviderId, customModels, true);
    await appSettingsService.update('modelProviders', {
      providers: {
        [normalizedProviderId]: {
          customModels: normalized,
        },
      },
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
}

export function buildModelProviderCatalog(
  catalogModels: readonly string[],
  settings: Record<string, { customModels: string[] }>,
  error?: string
): ModelProviderCatalogResult {
  const groups = new Map<string, MutableProviderGroup>();

  for (const provider of MODEL_PROVIDER_DEFINITIONS) {
    groups.set(provider.id, {
      id: provider.id,
      name: provider.name,
      catalogModels: new Set(),
      customModels: normalizeCustomModels(provider.id, settings[provider.id]?.customModels ?? []),
    });
  }

  for (const [providerId, providerSettings] of Object.entries(settings)) {
    if (groups.has(providerId)) continue;
    groups.set(providerId, {
      id: providerId,
      name: getModelProviderDefinition(providerId)?.name ?? formatProviderName(providerId),
      catalogModels: new Set(),
      customModels: normalizeCustomModels(providerId, providerSettings.customModels),
    });
  }

  for (const modelId of normalizeCatalogModelIds(catalogModels)) {
    const provider = resolveModelProvider(modelId);
    if (!provider) continue;
    const group = groups.get(provider.id) ?? {
      id: provider.id,
      name: provider.name,
      catalogModels: new Set<string>(),
      customModels: [],
    };
    group.catalogModels.add(modelId);
    groups.set(provider.id, group);
  }

  const knownOrder = new Map<string, number>(
    MODEL_PROVIDER_DEFINITIONS.map((provider, index) => [provider.id, index])
  );
  const providers = [...groups.values()].map(toCatalogGroup).sort((left, right) => {
    const leftOrder = knownOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = knownOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.name.localeCompare(right.name);
  });

  return {
    providers,
    fetchedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

function normalizeCustomModels(
  providerId: string,
  models: readonly string[],
  strict = false
): string[] {
  const normalized: string[] = [];
  for (const model of models) {
    const modelId = normalizeModelIdForProvider(providerId, model);
    if (!modelId) {
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
    if (
      modelId.length < 2 ||
      modelId.length > 100 ||
      !/^[a-z0-9][a-z0-9._:/+-]*$/i.test(modelId) ||
      normalized.includes(modelId)
    ) {
      continue;
    }
    normalized.push(modelId);
  }
  return normalized;
}

function toCatalogGroup(group: MutableProviderGroup): ModelProviderCatalogGroup {
  const models = new Map<string, ModelProviderCatalogItem>();
  for (const modelId of group.catalogModels) {
    models.set(modelId, { id: modelId, custom: false });
  }
  for (const modelId of group.customModels) {
    models.set(modelId, { id: modelId, custom: true });
  }

  return {
    id: group.id,
    name: group.name,
    models: [...models.values()].sort(
      (left, right) => Number(right.custom) - Number(left.custom) || left.id.localeCompare(right.id)
    ),
    customModels: group.customModels,
  };
}

function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const modelProviderCatalogService = new ModelProviderCatalogService();
