import { gateway } from 'ai';
import type {
  GlobalLlmModelCandidate,
  GlobalLlmModelDiscoveryInput,
  GlobalLlmModelDiscoveryResult,
  GlobalLlmModelDiscoverySource,
  GlobalLlmModelDiscoverySourceStatus,
} from '@shared/global-llm';
import { getRuntime } from '@shared/runtime-registry';
import { normalizeModelCandidates } from '@main/core/settings/model-candidate-parser';
import { runtimeModelCandidatesService } from '@main/core/settings/runtime-model-candidates-service';
import { filterModelsForRuntime } from '@main/core/settings/runtime-model-catalog';

const MAX_DISCOVERED_MODELS = 40;

type SourceLoadResult = {
  source: GlobalLlmModelDiscoverySource;
  models: string[];
  names?: Map<string, string>;
  descriptions?: Map<string, string>;
  error?: string;
};

export async function discoverGlobalLlmModels(
  input: GlobalLlmModelDiscoveryInput
): Promise<GlobalLlmModelDiscoveryResult> {
  const [gatewayResult, runtimeCatalogResult] = await Promise.all([
    loadGatewayModels(input),
    loadRuntimeCatalogModels(input),
  ]);
  const results = [gatewayResult, runtimeCatalogResult];
  const models = mergeModelCandidates(results);

  return {
    runtimeId: input.runtimeId,
    authProvider: input.authProvider,
    maasPlatformId: input.maasPlatformId ?? null,
    models,
    sources: results.map(toSourceStatus),
    fetchedAt: new Date().toISOString(),
  };
}

async function loadGatewayModels(input: GlobalLlmModelDiscoveryInput): Promise<SourceLoadResult> {
  try {
    const runtime = getRuntime(input.runtimeId);
    const response = await gateway.getAvailableModels();
    const gatewayModelIds = response.models.map((model) => model.id);
    const models = runtime
      ? filterModelsForRuntime(runtime, gatewayModelIds)
      : normalizeModelCandidates(gatewayModelIds);
    const names = new Map<string, string>();
    const descriptions = new Map<string, string>();

    if (runtime) {
      for (const model of response.models) {
        for (const normalized of filterModelsForRuntime(runtime, [model.id])) {
          if (model.name) names.set(normalized, model.name);
          if (model.description) descriptions.set(normalized, model.description);
        }
      }
    } else {
      for (const model of response.models) {
        if (model.name) names.set(model.id, model.name);
        if (model.description) descriptions.set(model.id, model.description);
      }
    }

    return { source: 'aiGateway', models, names, descriptions };
  } catch (error) {
    return {
      source: 'aiGateway',
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadRuntimeCatalogModels(
  input: GlobalLlmModelDiscoveryInput
): Promise<SourceLoadResult> {
  try {
    const result = await runtimeModelCandidatesService.inferNamingModelCandidates(input.runtimeId, {
      forceRefresh: input.forceRefresh,
    });
    return { source: 'runtimeCatalog', models: result.candidates };
  } catch (error) {
    return {
      source: 'runtimeCatalog',
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeModelCandidates(results: readonly SourceLoadResult[]): GlobalLlmModelCandidate[] {
  const byModel = new Map<string, GlobalLlmModelCandidate>();

  for (const result of results) {
    for (const model of normalizeModelCandidates(result.models)) {
      const current = byModel.get(model);
      if (current) {
        if (!current.sources.includes(result.source)) current.sources.push(result.source);
        if (!current.name) current.name = result.names?.get(model) ?? null;
        if (!current.description) current.description = result.descriptions?.get(model) ?? null;
        continue;
      }

      byModel.set(model, {
        id: model,
        name: result.names?.get(model) ?? null,
        description: result.descriptions?.get(model) ?? null,
        sources: [result.source],
      });
    }
  }

  return sortModelCandidatesForDisplay([...byModel.values()]).slice(0, MAX_DISCOVERED_MODELS);
}

function toSourceStatus(result: SourceLoadResult): GlobalLlmModelDiscoverySourceStatus {
  return {
    source: result.source,
    ok: !result.error,
    modelCount: result.models.length,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function sortModelCandidatesForDisplay(
  candidates: readonly GlobalLlmModelCandidate[]
): GlobalLlmModelCandidate[] {
  return [...candidates].sort(compareModelCandidates);
}

function compareModelCandidates(
  left: GlobalLlmModelCandidate,
  right: GlobalLlmModelCandidate
): number {
  const leftKey = modelSortKey(left);
  const rightKey = modelSortKey(right);

  const version = compareVersionsDesc(leftKey.version, rightKey.version);
  if (version !== 0) return version;

  if (leftKey.aliasRank !== rightKey.aliasRank) return leftKey.aliasRank - rightKey.aliasRank;
  if (leftKey.tierRank !== rightKey.tierRank) return rightKey.tierRank - leftKey.tierRank;
  if (leftKey.sourceRank !== rightKey.sourceRank) return rightKey.sourceRank - leftKey.sourceRank;

  return left.id.localeCompare(right.id);
}

function modelSortKey(candidate: GlobalLlmModelCandidate): {
  aliasRank: number;
  sourceRank: number;
  tierRank: number;
  version: number[];
} {
  const text = `${candidate.id} ${candidate.name ?? ''}`.toLowerCase();
  return {
    aliasRank: /\b(latest|default|current|chat-latest)\b/.test(text) ? 1 : 0,
    sourceRank: candidate.sources.length,
    tierRank: modelTierRank(text),
    version: extractModelVersion(text),
  };
}

function extractModelVersion(value: string): number[] {
  const match = value.match(/\b(?:gpt|claude|gemini|qwen|kimi|deepseek|o)[-.]?(\d+(?:[.-]\d+)*)\b/);
  const parts = match?.[1].split(/[.-]/) ?? value.match(/\d+/g)?.slice(0, 2) ?? [];
  return parts.map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
}

function compareVersionsDesc(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? -1;
    const rightPart = right[index] ?? -1;
    if (leftPart !== rightPart) return rightPart - leftPart;
  }
  return 0;
}

function modelTierRank(value: string): number {
  if (hasAnyToken(value, ['pro', 'opus', 'ultra', 'max'])) return 80;
  if (hasAnyToken(value, ['reason', 'thinking', 'r1', 'o3'])) return 70;
  if (hasAnyToken(value, ['mini'])) return 58;
  if (hasAnyToken(value, ['nano'])) return 56;
  if (hasAnyToken(value, ['haiku', 'flash', 'lite', 'small'])) return 35;
  if (hasAnyToken(value, ['sonnet', 'coder', 'code'])) return 55;
  return 50;
}

function hasAnyToken(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}
