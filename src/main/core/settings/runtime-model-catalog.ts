import type {
  AgentModelCandidateCacheEntry,
  RuntimeModelCandidateCacheSource,
} from '@shared/runtime-model-candidates';
import type { RuntimeDefinition } from '@shared/runtime-registry';
import { normalizeModelCandidates } from './model-candidate-parser';

const CATALOG_SOURCE: RuntimeModelCandidateCacheSource = 'catalog';

type CatalogModelCandidate = {
  model: string;
  fromPrefixedId: boolean;
};

const PROVIDER_TOKEN_STOP_WORDS = new Set([
  'agent',
  'agents',
  'app',
  'assistant',
  'bash',
  'cli',
  'cloud',
  'code',
  'coding',
  'command',
  'com',
  'docs',
  'github',
  'getting',
  'install',
  'interface',
  'line',
  'local',
  'models',
  'npm',
  'quickstart',
  'shell',
  'terminal',
  'tool',
  'workflow',
  'workflows',
]);

export function filterModelsForRuntime(
  provider: RuntimeDefinition,
  models: readonly string[]
): string[] {
  const tokens = providerRelevanceTokens(provider);
  if (tokens.length === 0) return [];

  const normalized: string[] = [];
  const candidates: CatalogModelCandidate[] = [];
  for (const model of models) {
    const candidate = normalizeCatalogModelIdForProvider(model, tokens);
    if (candidate) {
      candidates.push({
        ...candidate,
        model: toProviderOfficialModelId(provider, candidate.model),
      });
    }
  }
  for (const candidate of preferUnprefixedCandidates(candidates)) normalized.push(candidate.model);
  return normalizeModelCandidates(normalized);
}

export function sanitizeCatalogEntriesForRuntime(
  provider: RuntimeDefinition,
  entries: readonly AgentModelCandidateCacheEntry[]
): AgentModelCandidateCacheEntry[] {
  return entries
    .filter((entry) => entry.source === CATALOG_SOURCE)
    .map((entry) => ({
      ...entry,
      source: CATALOG_SOURCE,
      models: sanitizeCachedModelIdsForRuntime(provider, entry.models),
    }))
    .filter((entry) => entry.models.length > 0);
}

export function sanitizeCachedModelIdsForRuntime(
  provider: RuntimeDefinition,
  models: readonly string[]
): string[] {
  const tokens = providerRelevanceTokens(provider);
  if (tokens.length === 0) return normalizeModelCandidates(models);

  const normalized: string[] = [];
  const candidates: CatalogModelCandidate[] = [];
  for (const model of models) {
    const candidate = normalizeCachedModelIdForProvider(model, tokens);
    if (candidate) {
      candidates.push({
        ...candidate,
        model: toProviderOfficialModelId(provider, candidate.model),
      });
    }
  }
  for (const candidate of preferUnprefixedCandidates(candidates)) normalized.push(candidate.model);
  return normalizeModelCandidates(normalized);
}

function normalizeCatalogModelIdForProvider(
  model: string,
  providerTokens: readonly string[]
): CatalogModelCandidate | null {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= model.length - 1) {
    const value = model.toLowerCase();
    return providerTokens.some((token) => value.includes(token))
      ? { model, fromPrefixedId: false }
      : null;
  }

  const prefix = model.slice(0, slashIndex).toLowerCase();
  if (!providerTokens.includes(prefix)) return null;
  return { model: model.slice(slashIndex + 1), fromPrefixedId: true };
}

function normalizeCachedModelIdForProvider(
  model: string,
  providerTokens: readonly string[]
): CatalogModelCandidate | null {
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= model.length - 1) {
    return { model, fromPrefixedId: false };
  }

  const prefix = model.slice(0, slashIndex).toLowerCase();
  if (!providerTokens.includes(prefix)) return null;
  return { model: model.slice(slashIndex + 1), fromPrefixedId: true };
}

function preferUnprefixedCandidates(
  candidates: readonly CatalogModelCandidate[]
): CatalogModelCandidate[] {
  const unprefixedModelKeys = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.fromPrefixedId) unprefixedModelKeys.add(modelEquivalenceKey(candidate.model));
  }

  return candidates.filter((candidate) => {
    if (!candidate.fromPrefixedId) return true;
    return !unprefixedModelKeys.has(modelEquivalenceKey(candidate.model));
  });
}

function modelEquivalenceKey(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toProviderOfficialModelId(provider: RuntimeDefinition, model: string): string {
  if (provider.id !== 'claude') return model;
  return model.replace(/(\d)\.(\d)/g, '$1-$2');
}

function providerRelevanceTokens(provider: RuntimeDefinition): string[] {
  const raw = [
    provider.id,
    provider.name,
    provider.description,
    provider.cli,
    ...(provider.commands ?? []),
    provider.docUrl ? urlSearchText(provider.docUrl) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const tokens = new Set<string>();
  for (const match of raw.matchAll(/[a-z0-9]+/g)) {
    const token = match[0];
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (PROVIDER_TOKEN_STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  return [...tokens];
}

function urlSearchText(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname} ${url.pathname}`;
  } catch {
    return value;
  }
}
