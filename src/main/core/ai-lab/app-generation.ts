import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveRuntimeBaseEnv, resolveRuntimeEnv } from '../conversations/impl/runtime-env';
import {
  buildAppGenerationPrompt,
  parseGeneratedAiLabApp,
  type GeneratedAiLabApp,
} from './app-generation-contract';

const APP_GENERATION_TIMEOUT_MS = 3 * 60_000;

export async function generateAiLabApp(input: {
  prompt: string;
  projectPath: string;
  runtimeId: RuntimeId;
  model?: string | null;
  systemPrompt?: string;
}): Promise<GeneratedAiLabApp> {
  if (input.runtimeId !== 'codex' && input.runtimeId !== 'claude') {
    throw new Error(
      `Yoda Build does not support ${getRuntime(input.runtimeId)?.name ?? input.runtimeId}.`
    );
  }
  const commandPath = await resolveCommandPath(input.runtimeId, new LocalExecutionContext());
  if (!commandPath) {
    throw new Error(
      `${getRuntime(input.runtimeId)?.name ?? input.runtimeId} CLI is not available.`
    );
  }
  const providerConfig = await runtimeOverrideSettings.getItem(input.runtimeId);
  const modelArgs = input.model?.trim() ? ['--model', input.model.trim()] : [];
  const command = buildGenerationCommand(input.runtimeId, modelArgs);

  const result = await runAgentCli({
    command: commandPath,
    args: command.args,
    stdin: buildAppGenerationPrompt(input.prompt, {
      projectPath: input.projectPath,
      systemPrompt: input.systemPrompt,
    }),
    cwd: input.projectPath,
    env: {
      ...buildExternalToolEnv(resolveRuntimeBaseEnv(process.env, providerConfig, input.runtimeId)),
      ...resolveRuntimeEnv(providerConfig, { runtimeId: input.runtimeId }),
    },
    timeoutMs: APP_GENERATION_TIMEOUT_MS,
    runtimeName: getRuntime(input.runtimeId)?.name ?? input.runtimeId,
    purpose: 'ai-lab-app-generation',
    model: input.model,
    metadata: { promptChars: String(input.prompt.length), projectPath: input.projectPath },
  });
  return parseGeneratedAiLabApp(extractAgentMessageText(result.stdout));
}

function buildGenerationCommand(runtimeId: 'codex' | 'claude', modelArgs: string[]) {
  if (runtimeId === 'claude') {
    return {
      args: ['--print', '--output-format', 'text', '--no-session-persistence', ...modelArgs],
    };
  }
  return {
    args: [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      ...modelArgs,
      '--json',
      '-',
    ],
  };
}
