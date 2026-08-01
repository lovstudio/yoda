import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveCommandPath } from '@main/core/dependencies/probe';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveRuntimeBaseEnv, resolveRuntimeEnv } from '../conversations/impl/runtime-env';
import {
  buildQuickActionCompilationPrompt,
  parseCompiledQuickAction,
} from './quick-action-contract';

const QUICK_ACTION_COMPILATION_TIMEOUT_MS = 2 * 60_000;

export async function compileQuickAction(input: {
  intent: string;
  projectPath: string;
  runtimeId: RuntimeId;
  executionSummary?: string;
}) {
  const intent = input.intent.trim();
  if (!intent) throw new Error('Describe the operation to compile.');
  if (intent.length > 8_000) throw new Error('The operation description is too long.');
  if (input.runtimeId !== 'codex' && input.runtimeId !== 'claude') {
    throw new Error(
      `Quick action compilation does not support ${
        getRuntime(input.runtimeId)?.name ?? input.runtimeId
      }.`
    );
  }

  const commandPath = await resolveCommandPath(input.runtimeId, new LocalExecutionContext());
  if (!commandPath) {
    throw new Error(`${getRuntime(input.runtimeId)?.name ?? input.runtimeId} CLI is unavailable.`);
  }
  const providerConfig = await runtimeOverrideSettings.getItem(input.runtimeId);
  const result = await runAgentCli({
    command: commandPath,
    args: buildCompilationArgs(input.runtimeId),
    stdin: buildQuickActionCompilationPrompt(intent, input.projectPath, input.executionSummary),
    cwd: input.projectPath,
    env: {
      ...buildExternalToolEnv(resolveRuntimeBaseEnv(process.env, providerConfig, input.runtimeId)),
      ...resolveRuntimeEnv(providerConfig, { runtimeId: input.runtimeId }),
    },
    timeoutMs: QUICK_ACTION_COMPILATION_TIMEOUT_MS,
    runtimeName: getRuntime(input.runtimeId)?.name ?? input.runtimeId,
    purpose: 'quick-action-compilation',
    metadata: {
      projectPath: input.projectPath,
      intentChars: String(intent.length),
    },
  });
  return parseCompiledQuickAction(extractAgentMessageText(result.stdout));
}

function buildCompilationArgs(runtimeId: 'codex' | 'claude'): string[] {
  if (runtimeId === 'claude') {
    return ['--print', '--output-format', 'text', '--no-session-persistence'];
  }
  return [
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--color',
    'never',
    '--json',
    '-',
  ];
}
