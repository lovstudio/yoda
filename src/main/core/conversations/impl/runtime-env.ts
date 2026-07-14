import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeCustomConfig } from '@shared/app-settings';
import { getRuntimeAccountProfile, type RuntimeId } from '@shared/runtime-registry';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV = 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN';

/**
 * Runtimes that ride on the Claude Code CLI but point it at a third-party
 * Anthropic-compatible endpoint. The base URL is forced here; the API key is
 * supplied by the user via ANTHROPIC_AUTH_TOKEN.
 */
const CLAUDE_COMPATIBLE_BASE_URLS: Partial<Record<RuntimeId, string>> = {
  glm: 'https://api.z.ai/api/anthropic',
  step: 'https://api.stepfun.com/step_plan',
};

/** Runtimes whose underlying binary is Claude Code (and thus share its tmux quirks). */
function isClaudeBased(runtimeId: RuntimeId | undefined): boolean {
  return (
    runtimeId === 'claude' || (runtimeId !== undefined && runtimeId in CLAUDE_COMPATIBLE_BASE_URLS)
  );
}

function shouldForwardOfficialApiEnv(providerConfig: RuntimeCustomConfig | undefined): boolean {
  return !providerConfig?.authProvider || providerConfig.authProvider === 'official-api';
}

function officialApiEnvVarsForProvider(runtimeId: RuntimeId | undefined): Set<string> {
  if (!runtimeId) return new Set();
  return new Set(getRuntimeAccountProfile(runtimeId).officialApi.envVars);
}

export function resolveAgentApiEnvVars(
  providerConfig: RuntimeCustomConfig | undefined,
  runtimeId: RuntimeId
): false | readonly string[] {
  if (!shouldForwardOfficialApiEnv(providerConfig)) return false;
  return getRuntimeAccountProfile(runtimeId).officialApi.envVars;
}

export function resolveRuntimeBaseEnv(
  baseEnv: NodeJS.ProcessEnv,
  providerConfig: RuntimeCustomConfig | undefined,
  runtimeId: RuntimeId
): NodeJS.ProcessEnv {
  if (shouldForwardOfficialApiEnv(providerConfig)) return baseEnv;

  const env = { ...baseEnv };
  for (const key of officialApiEnvVarsForProvider(runtimeId)) {
    delete env[key];
  }
  return env;
}

export function resolveRuntimeEnv(
  providerConfig: RuntimeCustomConfig | undefined,
  options: { runtimeId?: RuntimeId; tmuxEnabled?: boolean } = {}
): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const officialApiEnvVars = officialApiEnvVarsForProvider(options.runtimeId);
  const forwardOfficialApiEnv = shouldForwardOfficialApiEnv(providerConfig);

  if (providerConfig?.env) {
    for (const [key, value] of Object.entries(providerConfig.env)) {
      if (!forwardOfficialApiEnv && officialApiEnvVars.has(key)) continue;
      if (ENV_NAME_PATTERN.test(key)) env[key] = value;
    }
  }

  // Pin Claude-compatible runtimes (GLM, Step) to their endpoint unless the user
  // overrode it (the API key itself is supplied via ANTHROPIC_AUTH_TOKEN).
  const compatibleBaseUrl = options.runtimeId
    ? CLAUDE_COMPATIBLE_BASE_URLS[options.runtimeId]
    : undefined;
  if (compatibleBaseUrl && env.ANTHROPIC_BASE_URL === undefined) {
    env.ANTHROPIC_BASE_URL = compatibleBaseUrl;
  }

  if (
    isClaudeBased(options.runtimeId) &&
    options.tmuxEnabled === true &&
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] === undefined
  ) {
    env[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV] = '1';
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * Resolves the state root used by the actual provider process. Provider env
 * overrides inherited env; both fall back to the CLI's conventional home.
 */
export function resolveRuntimeStateDirectory(
  runtimeId: 'claude' | 'codex',
  providerConfig: RuntimeCustomConfig | undefined,
  options: { processEnv?: NodeJS.ProcessEnv; home?: string } = {}
): string {
  const envName = runtimeId === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  const defaultDirectory = runtimeId === 'codex' ? '.codex' : '.claude';
  const providerEnv = resolveRuntimeEnv(providerConfig, { runtimeId });
  const defaultPath = join(options.home ?? homedir(), defaultDirectory);

  if (providerEnv?.[envName] !== undefined) {
    return providerEnv[envName].trim() || defaultPath;
  }
  const inheritedEnv = options.processEnv ?? process.env;
  return inheritedEnv[envName]?.trim() || defaultPath;
}

export function resolveRuntimeTmuxEnv(
  providerEnv: Record<string, string> | undefined
): Record<string, string> | undefined {
  const claudeAlternateScreenOverride = providerEnv?.[CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV];
  if (claudeAlternateScreenOverride === undefined) return undefined;
  return {
    [CLAUDE_DISABLE_ALTERNATE_SCREEN_ENV]: claudeAlternateScreenOverride,
  };
}
