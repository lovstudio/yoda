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
    const modelNamesByGatewayId = new Map(
      response.models.map((model) => [model.id, model.name] as const)
    );
    const models = runtime
      ? filterModelsForRuntime(runtime, gatewayModelIds)
      : normalizeModelCandidates(gatewayModelIds);
    const names = new Map<string, string>();

    if (runtime) {
      for (const model of response.models) {
        for (const normalized of filterModelsForRuntime(runtime, [model.id])) {
          if (model.name) names.set(normalized, model.name);
        }
      }
    } else {
      for (const [id, name] of modelNamesByGatewayId) names.set(id, name);
    }

    return { source: 'aiGateway', models, names };
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
        continue;
      }

      byModel.set(model, {
        id: model,
        name: result.names?.get(model) ?? null,
        sources: [result.source],
      });
    }
  }

  return [...byModel.values()].slice(0, MAX_DISCOVERED_MODELS);
}

function toSourceStatus(result: SourceLoadResult): GlobalLlmModelDiscoverySourceStatus {
  return {
    source: result.source,
    ok: !result.error,
    modelCount: result.models.length,
    ...(result.error ? { error: result.error } : {}),
  };
}
