import {
  getLlmProfile,
  normalizeLlmSettings,
  type GlobalLlmDebugInput,
  type GlobalLlmDebugResult,
} from '@shared/global-llm';
import { createRPCController } from '@shared/ipc/rpc';
import { appSettingsService } from '@main/core/settings/settings-service';
import { requestUtilityAgentText } from '@main/core/tasks/name-generation/task-naming-service';

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
    return failedResult(
      error instanceof Error ? error.message : String(error),
      Date.now() - startedAt
    );
  }
}

function failedResult(error: string, durationMs: number): GlobalLlmDebugResult {
  return {
    success: false,
    profileId: null,
    profileName: null,
    runtimeId: null,
    authProvider: null,
    maasPlatformId: null,
    model: null,
    output: '',
    durationMs,
    error,
  };
}

export const llmController = createRPCController({
  debug,
});
