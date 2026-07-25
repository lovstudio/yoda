import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  supportsMaasPlatformForRuntime,
  type MaasPlatformId,
  type MaasRuntimeBinding,
} from '@shared/maas';
import {
  getRuntimeAccountProfile,
  isValidRuntimeId,
  supportsRuntimeMaasSwitch,
  type RuntimeId,
} from '@shared/runtime-registry';

export type MaasRuntimeCredentials = {
  platformId: MaasPlatformId;
  endpoint: string;
  apiKey: string;
};

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

export function supportsMaasRuntimeBinding(runtimeId: string): runtimeId is RuntimeId {
  return isValidRuntimeId(runtimeId) && supportsRuntimeMaasSwitch(runtimeId);
}

/**
 * Keep Codex on its built-in `openai` provider so persisted threads remain
 * readable by the native Codex app. `openai_base_url` is Codex's supported
 * config override; OPENAI_BASE_URL alone is no longer sufficient.
 */
export function resolveMaasRuntimeCommandArgs(
  runtimeId: RuntimeId,
  credentials: MaasRuntimeCredentials
): string[] {
  if (runtimeId !== 'codex') return [];

  const endpoint = credentials.endpoint.replace(/\/+$/, '');
  const overrides = [
    `model_provider=${formatTomlString('openai')}`,
    `openai_base_url=${formatTomlString(endpoint)}`,
  ];
  return overrides.flatMap((override) => ['-c', override]);
}

export function resolveMaasRuntimeEnv(
  runtimeId: RuntimeId,
  credentials: MaasRuntimeCredentials
): Record<string, string> | undefined {
  const spec = getRuntimeAccountProfile(runtimeId).maas.runtimeEnv;
  if (!spec || !supportsMaasPlatformForRuntime(runtimeId, credentials.platformId)) return undefined;

  let endpoint = credentials.endpoint.replace(/\/+$/, '');
  if (runtimeId === 'claude' && credentials.platformId === 'zenmux') {
    endpoint = endpoint.replace(/\/api\/v1$/, '/api/anthropic');
  }
  if (runtimeId === 'claude' && credentials.platformId === 'openrouter') {
    endpoint = endpoint.replace(/\/api\/v1$/, '/api');
  }

  const env = Object.fromEntries([
    ...spec.apiKeyEnvVars.map((key) => [key, credentials.apiKey] as const),
    ...spec.baseUrlEnvVars.map((key) => [key, endpoint] as const),
  ]);
  if (runtimeId === 'codex') {
    // Codex gives CODEX_API_KEY precedence over credentials persisted in
    // auth.json. OPENAI_API_KEY alone does not override an existing login.
    env.CODEX_API_KEY = credentials.apiKey;
  }
  if (runtimeId === 'claude') {
    env.ANTHROPIC_API_KEY = '';
  }
  if (runtimeId === 'claude' && credentials.platformId === 'zenmux') {
    env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }
  return env;
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
