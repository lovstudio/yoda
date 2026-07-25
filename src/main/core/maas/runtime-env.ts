import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  getMaasPlatformDefinition,
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

const CODEX_MAAS_PROVIDER_ID = 'yoda-maas';

function formatTomlString(value: string): string {
  return JSON.stringify(value);
}

export function supportsMaasRuntimeBinding(runtimeId: string): runtimeId is RuntimeId {
  return isValidRuntimeId(runtimeId) && supportsRuntimeMaasSwitch(runtimeId);
}

/**
 * Codex no longer reliably applies OPENAI_BASE_URL to its built-in OpenAI
 * provider. Select an invocation-scoped custom provider so the MaaS key and
 * endpoint are always consumed together instead of sending the MaaS key to
 * api.openai.com.
 */
export function resolveMaasRuntimeCommandArgs(
  runtimeId: RuntimeId,
  credentials: MaasRuntimeCredentials
): string[] {
  if (runtimeId !== 'codex') return [];

  const providerName = `Yoda MaaS (${getMaasPlatformDefinition(credentials.platformId).name})`;
  const endpoint = credentials.endpoint.replace(/\/+$/, '');
  const overrides = [
    `model_provider=${formatTomlString(CODEX_MAAS_PROVIDER_ID)}`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.name=${formatTomlString(providerName)}`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.base_url=${formatTomlString(endpoint)}`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.env_key=${formatTomlString('OPENAI_API_KEY')}`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.wire_api=${formatTomlString('responses')}`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.requires_openai_auth=false`,
    `model_providers.${CODEX_MAAS_PROVIDER_ID}.supports_websockets=false`,
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
