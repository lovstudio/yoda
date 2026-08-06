import type { RuntimeCustomConfig } from '@shared/app-settings';
import {
  getMaasPlatformTemplateId,
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
    // Codex authenticates to the localhost MaaS Gateway through its provider
    // config. The upstream credential stays in Yoda's encrypted store and is
    // delivered to the Gateway over utility-process IPC.
    return undefined;
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
