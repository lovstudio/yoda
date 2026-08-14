import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  getMaasPlatformTemplateId,
  resolveMaasEnvKey,
  supportsMaasPlatformForRuntime,
  type MaasPlatformId,
  type MaasRuntimeBinding,
} from '@shared/maas';
import {
  normalizeModelIdForProvider,
  resolveModelProvider,
  toRuntimeModelId,
} from '@shared/model-provider-catalog';
import {
  getRuntimeAccountProfile,
  isValidRuntimeId,
  supportsRuntimeMaasSwitch,
  type RuntimeId,
} from '@shared/runtime-registry';
import { CODEX_SHARED_PROVIDER_ID, resolveCodexMaasProviderSpec } from './codex-maas-provider';

export type MaasRuntimeCredentials = {
  platformId: MaasPlatformId;
  displayName?: string;
  endpoint: string;
  apiKey: string;
  envKey?: string;
  syncToAgentClient?: boolean;
};

export function supportsMaasRuntimeBinding(runtimeId: string): runtimeId is RuntimeId {
  return isValidRuntimeId(runtimeId) && supportsRuntimeMaasSwitch(runtimeId);
}

export function resolveMaasRuntimeEnv(
  runtimeId: RuntimeId,
  credentials: MaasRuntimeCredentials
): Record<string, string> | undefined {
  const spec = getRuntimeAccountProfile(runtimeId).maas.runtimeEnv;
  if (!spec || !supportsMaasPlatformForRuntime(runtimeId, credentials.platformId)) return undefined;

  if (runtimeId === 'codex') {
    const envKey = resolveMaasEnvKey(
      credentials.platformId,
      credentials.displayName,
      credentials.envKey
    );
    return { [envKey]: credentials.apiKey };
  }

  let endpoint = credentials.endpoint.replace(/\/+$/, '');
  const templateId = getMaasPlatformTemplateId(credentials.platformId);
  if (runtimeId === 'claude' && templateId === 'zenmux') {
    endpoint = endpoint.replace(/\/api\/v1$/, '/api/anthropic');
  }
  if (runtimeId === 'claude' && templateId === 'openrouter') {
    endpoint = endpoint.replace(/\/api\/v1$/, '/api');
  }

  const env = Object.fromEntries([
    ...spec.apiKeyEnvVars.map((key) => [key, credentials.apiKey] as const),
    ...spec.baseUrlEnvVars.map((key) => [key, endpoint] as const),
  ]);
  if (runtimeId === 'claude') {
    env.ANTHROPIC_API_KEY = '';
  }
  if (runtimeId === 'claude' && templateId === 'zenmux') {
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }
  return env;
}

export function resolveCodexMaasRuntimeArgs(
  credentials: MaasRuntimeCredentials,
  modelCatalogPath?: string
): string[] {
  const provider = resolveCodexMaasProviderSpec(credentials.platformId, credentials.displayName);
  const envKey = resolveMaasEnvKey(
    credentials.platformId,
    credentials.displayName,
    credentials.envKey
  );
  const baseUrl = credentials.endpoint.trim().replace(/\/+$/, '');
  return [
    '-c',
    `model_provider=${formatTomlString(provider.providerId)}`,
    '-c',
    `model_providers.${provider.providerId}.name=${formatTomlString(provider.name)}`,
    '-c',
    `model_providers.${provider.providerId}.base_url=${formatTomlString(baseUrl)}`,
    '-c',
    `model_providers.${provider.providerId}.wire_api="responses"`,
    '-c',
    `model_providers.${provider.providerId}.env_key=${formatTomlString(envKey)}`,
    ...(modelCatalogPath ? ['-c', `model_catalog_json=${formatTomlString(modelCatalogPath)}`] : []),
  ];
}

/**
 * Project Codex's built-in OpenAI account through the same provider id used by
 * MaaS. Authentication remains owned by Codex via auth.json; only the history
 * bucket changes.
 */
export function resolveCodexOfficialRuntimeArgs(): string[] {
  return [
    '-c',
    `model_provider=${formatTomlString(CODEX_SHARED_PROVIDER_ID)}`,
    '-c',
    `model_providers.${CODEX_SHARED_PROVIDER_ID}.name="OpenAI"`,
    '-c',
    `model_providers.${CODEX_SHARED_PROVIDER_ID}.requires_openai_auth=true`,
    '-c',
    `model_providers.${CODEX_SHARED_PROVIDER_ID}.supports_websockets=true`,
    '-c',
    `model_providers.${CODEX_SHARED_PROVIDER_ID}.wire_api="responses"`,
  ];
}

/**
 * Codex normally uses provider-native model ids such as `gpt-5.6-sol`, while
 * ZenMux exposes the same model as `openai/gpt-5.6-sol`. Keep the native id for
 * direct providers and restore the catalog prefix only at the ZenMux boundary.
 */
export function resolveCodexMaasModelId(
  credentials: MaasRuntimeCredentials,
  model: string
): string {
  const normalized = model.trim();
  if (!normalized || normalized.includes('/') || !usesZenmuxModelNamespace(credentials)) {
    return normalized;
  }

  const provider = resolveModelProvider(normalized);
  return provider
    ? (normalizeModelIdForProvider(provider.id, normalized) ?? normalized)
    : normalized;
}

export function resolveCodexNativeModelId(model: string): string {
  const normalized = model.trim();
  if (!normalized) return normalized;
  const provider = resolveModelProvider(normalized);
  return provider ? toRuntimeModelId(provider.id, normalized) : normalized;
}

export function rewriteCodexMaasModelArgs(
  args: readonly string[],
  credentials: MaasRuntimeCredentials
): string[] {
  const rewritten = [...args];
  for (let index = 0; index < rewritten.length; index += 1) {
    const argument = rewritten[index];
    if (argument === '--model' || argument === '-m') {
      const model = rewritten[index + 1];
      if (model) rewritten[index + 1] = resolveCodexMaasModelId(credentials, model);
      index += 1;
      continue;
    }
    for (const prefix of ['--model=', '-m=']) {
      if (!argument.startsWith(prefix)) continue;
      rewritten[index] = `${prefix}${resolveCodexMaasModelId(
        credentials,
        argument.slice(prefix.length)
      )}`;
      break;
    }
  }
  return rewritten;
}

function usesZenmuxModelNamespace(credentials: MaasRuntimeCredentials): boolean {
  if (getMaasPlatformTemplateId(credentials.platformId) === 'zenmux') return true;
  try {
    const hostname = new URL(credentials.endpoint).hostname.toLowerCase();
    return hostname === 'zenmux.ai' || hostname.endsWith('.zenmux.ai');
  } catch {
    return false;
  }
}

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

export function resolveRestoredMaasRuntimeConfig(
  currentConfig: RuntimeCustomConfig,
  binding: MaasRuntimeBinding | undefined
): RuntimeCustomConfig {
  if (binding?.previousConfig !== undefined) {
    return structuredClone(binding.previousConfig);
  }

  const restored = { ...currentConfig };
  if (binding?.previousAuthProvider) {
    restored.authProvider = binding.previousAuthProvider;
  } else {
    delete restored.authProvider;
  }
  if (binding?.previousMaasPlatformId) {
    restored.maasPlatformId = binding.previousMaasPlatformId;
  } else {
    delete restored.maasPlatformId;
  }
  return restored;
}
