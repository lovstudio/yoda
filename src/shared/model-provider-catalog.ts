import type { RuntimeId } from './runtime-registry';

export const MAX_CUSTOM_MODELS_PER_PROVIDER = 40;
export const MODEL_PROVIDER_AUTO_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export const MODEL_PROVIDER_CATALOG_SOURCES = ['official', 'aggregate', 'custom'] as const;
export type ModelProviderCatalogSource = (typeof MODEL_PROVIDER_CATALOG_SOURCES)[number];

export const MODEL_PROVIDER_UPDATE_STATUSES = [
  'current',
  'snapshot',
  'stale',
  'aggregateOnly',
] as const;
export type ModelProviderUpdateStatus = (typeof MODEL_PROVIDER_UPDATE_STATUSES)[number];

export type ModelProviderDefinition = {
  id: string;
  name: string;
  catalogPrefixes: readonly string[];
  modelPrefixes: readonly string[];
  runtimeIds: readonly RuntimeId[];
};

export const MODEL_PROVIDER_DEFINITIONS = [
  {
    id: 'openai',
    name: 'OpenAI',
    catalogPrefixes: ['openai', 'azure'],
    modelPrefixes: ['gpt-', 'chatgpt-', 'o1', 'o3', 'o4'],
    runtimeIds: ['codex'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    catalogPrefixes: ['anthropic'],
    modelPrefixes: ['claude-'],
    runtimeIds: ['claude'],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    catalogPrefixes: ['moonshotai', 'moonshot', 'kimi'],
    modelPrefixes: ['kimi-', 'moonshot-'],
    runtimeIds: ['kimi'],
  },
  {
    id: 'google',
    name: 'Google',
    catalogPrefixes: ['google'],
    modelPrefixes: ['gemini-'],
    runtimeIds: ['gemini'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    catalogPrefixes: ['deepseek'],
    modelPrefixes: ['deepseek-'],
    runtimeIds: [],
  },
  {
    id: 'qwen',
    name: 'Qwen',
    catalogPrefixes: ['qwen', 'alibaba', 'dashscope'],
    modelPrefixes: ['qwen-'],
    runtimeIds: ['qwen'],
  },
  {
    id: 'xai',
    name: 'xAI',
    catalogPrefixes: ['x-ai', 'xai'],
    modelPrefixes: ['grok-'],
    runtimeIds: ['grok'],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    catalogPrefixes: ['mistralai', 'mistral'],
    modelPrefixes: ['mistral-', 'codestral-'],
    runtimeIds: ['mistral'],
  },
  {
    id: 'meta',
    name: 'Meta',
    catalogPrefixes: ['meta-llama', 'meta'],
    modelPrefixes: ['llama-'],
    runtimeIds: [],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    catalogPrefixes: ['minimax'],
    modelPrefixes: ['minimax-'],
    runtimeIds: [],
  },
  {
    id: 'zhipu',
    name: 'Zhipu AI',
    catalogPrefixes: ['z-ai', 'zhipuai', 'zhipu'],
    modelPrefixes: ['glm-'],
    runtimeIds: [],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    catalogPrefixes: ['cohere'],
    modelPrefixes: ['command-'],
    runtimeIds: [],
  },
] as const satisfies readonly ModelProviderDefinition[];

export type ModelProviderCatalogItem = {
  id: string;
  custom: boolean;
  sources: ModelProviderCatalogSource[];
};

export type ModelProviderCatalogGroup = {
  id: string;
  name: string;
  models: ModelProviderCatalogItem[];
  customModels: string[];
  officialSourceUrl: string | null;
  officialSnapshotAt: string | null;
  officialFetchedAt: string | null;
  lastUpdateAttemptAt: string | null;
  officialApiSupported: boolean;
  officialApiConfigured: boolean;
  updateStatus: ModelProviderUpdateStatus;
  updateError?: string;
};

export type ModelProviderCatalogResult = {
  providers: ModelProviderCatalogGroup[];
  fetchedAt: string;
  automaticUpdatesEnabled: boolean;
  lastAutomaticRefreshAt: string | null;
  nextAutomaticRefreshAt: string | null;
  error?: string;
};

export function getModelProviderDefinition(
  providerId: string
): ModelProviderDefinition | undefined {
  return MODEL_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId);
}

export function resolveModelProvider(
  modelId: string
): Pick<ModelProviderDefinition, 'id' | 'name'> | null {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return null;

  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0) {
    const prefix = normalized.slice(0, slashIndex);
    const known = MODEL_PROVIDER_DEFINITIONS.find((provider) =>
      provider.catalogPrefixes.some((candidate) => candidate === prefix)
    );
    return known ?? { id: prefix, name: formatModelProviderName(prefix) };
  }

  return (
    MODEL_PROVIDER_DEFINITIONS.find((provider) =>
      provider.modelPrefixes.some((prefix) => normalized.startsWith(prefix))
    ) ?? null
  );
}

export function normalizeModelIdForProvider(providerId: string, modelId: string): string | null {
  const normalized = modelId.trim();
  if (!normalized) return null;

  const provider = getModelProviderDefinition(providerId);
  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0) {
    const prefix = normalized.slice(0, slashIndex).toLowerCase();
    const allowedPrefixes = provider?.catalogPrefixes ?? [providerId];
    return allowedPrefixes.some((candidate) => candidate === prefix) ? normalized : null;
  }

  const prefix = provider?.catalogPrefixes[0] ?? providerId;
  return `${prefix}/${normalized}`;
}

export function modelProviderIdsForRuntime(runtimeId: RuntimeId): string[] {
  return MODEL_PROVIDER_DEFINITIONS.filter((provider) =>
    provider.runtimeIds.some((candidate) => candidate === runtimeId)
  ).map((provider) => provider.id);
}

export function toRuntimeModelId(providerId: string, modelId: string): string {
  const provider = getModelProviderDefinition(providerId);
  const slashIndex = modelId.indexOf('/');
  const prefix = slashIndex > 0 ? modelId.slice(0, slashIndex).toLowerCase() : '';
  const nativeId =
    slashIndex > 0 &&
    (provider?.catalogPrefixes ?? [providerId]).some((candidate) => candidate === prefix)
      ? modelId.slice(slashIndex + 1)
      : modelId;

  return providerId === 'anthropic' ? nativeId.replace(/(\d)\.(\d)/g, '$1-$2') : nativeId;
}

function formatModelProviderName(providerId: string): string {
  return providerId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
