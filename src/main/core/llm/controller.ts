import {
  getLlmProfile,
  normalizeLlmSettings,
  type GlobalLlmDebugInput,
  type GlobalLlmDebugResult,
  type GlobalLlmModelDiscoveryInput,
  type GlobalLlmModelDiscoveryResult,
} from '@shared/global-llm';
import { createRPCController } from '@shared/ipc/rpc';
import { appSettingsService } from '@main/core/settings/settings-service';
import { requestUtilityAgentText } from '@main/core/tasks/name-generation/task-naming-service';
import { summarizeLlmDebugError } from './debug-error';
import { discoverGlobalLlmModels } from './model-discovery-service';
import {
  createCustomModelProvider,
  deleteCustomModelProvider,
  listModelProviders,
  refreshModelProviders,
  setModelProviderAutomaticUpdates,
  updateModelProviderCustomModels,
} from './model-provider-operations';

const MAX_DEBUG_PROMPT_CHARS = 8_000;

async function debug(input: GlobalLlmDebugInput): Promise<GlobalLlmDebugResult> {
  const startedAt = Date.now();
  const prompt = input.prompt.trim();
  if (!prompt) {
    return failedResult('Debug prompt is empty.', Date.now() - startedAt);
  }

  const settings = normalizeLlmSettings(await appSettingsService.get('llm'));
  const profile = getLlmProfile(settings, input.profileId || settings.defaultProfileId);
  const clippedPrompt = prompt.slice(0, MAX_DEBUG_PROMPT_CHARS);

  try {
    const result = await requestUtilityAgentText({
      prompt: clippedPrompt,
      cwd: process.cwd(),
      purpose: 'llm-debug',
      profileId: profile.id,
      metadata: {
        llmProfileId: profile.id,
        runtimeId: profile.runtimeId,
        authProvider: profile.authProvider,
      },
    });
    return {
      success: true,
      profileId: profile.id,
      profileName: profile.name,
      runtimeId: result.runtimeId,
      authProvider: profile.authProvider,
      maasPlatformId: profile.authProvider === 'yoda-maas' ? profile.maasPlatformId : null,
      model: result.model || profile.model || null,
      output: result.text,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error);
    return failedResult(summarizeLlmDebugError(rawError), Date.now() - startedAt, {
      profileId: profile.id,
      profileName: profile.name,
      runtimeId: profile.runtimeId,
      authProvider: profile.authProvider,
      maasPlatformId: profile.authProvider === 'yoda-maas' ? profile.maasPlatformId : null,
      model: profile.model || null,
      rawError,
    });
  }
}

function failedResult(
  error: string,
  durationMs: number,
  context: Partial<GlobalLlmDebugResult> = {}
): GlobalLlmDebugResult {
  return {
    success: false,
    profileId: context.profileId ?? null,
    profileName: context.profileName ?? null,
    runtimeId: context.runtimeId ?? null,
    authProvider: context.authProvider ?? null,
    maasPlatformId: context.maasPlatformId ?? null,
    model: context.model ?? null,
    output: '',
    durationMs,
    error,
    rawError: context.rawError,
  };
}

async function discoverModels(
  input: GlobalLlmModelDiscoveryInput
): Promise<GlobalLlmModelDiscoveryResult> {
  return discoverGlobalLlmModels(input);
}

export const llmController = createRPCController({
  createCustomModelProvider,
  debug,
  deleteCustomModelProvider,
  discoverModels,
  listModelProviders,
  refreshModelProviders,
  setModelProviderAutomaticUpdates,
  updateModelProviderCustomModels,
});
