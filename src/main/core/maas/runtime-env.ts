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
import { CODEX_MAAS_API_KEY_ENV } from './codex-maas-user-environment';

export type MaasRuntimeCredentials = {
  platformId: MaasPlatformId;
  displayName?: string;
  endpoint: string;
  apiKey: string;
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
    return { [CODEX_MAAS_API_KEY_ENV]: credentials.apiKey };
  }

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
