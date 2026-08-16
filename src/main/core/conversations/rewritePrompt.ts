import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type { TaskOutputLanguage } from '@shared/project-settings';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveSelectedUtilityAgent } from '@main/core/agents-config/builtin-agent-resolver';
import { projectManager } from '@main/core/projects/project-manager';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveRuntimeBaseEnv, resolveRuntimeEnv } from './impl/runtime-env';
import {
  buildPromptRewritePrompt,
  cleanRewrittenPrompt,
  resolvePromptRewriteTargetLanguage,
  type PromptRewriteTargetLanguage,
} from './prompt-rewrite-utils';

const PROMPT_REWRITE_TIMEOUT_MS = 60_000;

type PromptRewriteCommand = { command: string; args: string[]; stdin: string };

export type RewritePromptParams = {
  prompt: string;
  language: TaskOutputLanguage;
  projectId?: string | null;
  runtimeId?: RuntimeId | null;
  model?: string | null;
  appLanguage?: PromptRewriteTargetLanguage | null;
};

export type RewritePromptResult = {
  prompt: string;
  language: PromptRewriteTargetLanguage | 'prompt';
  changed: boolean;
  runtimeId: RuntimeId | null;
  runtimeName: string | null;
  model: string | null;
};

export async function rewritePrompt(params: RewritePromptParams): Promise<RewritePromptResult> {
  const original = params.prompt;
  const targetLanguage = resolvePromptRewriteTargetLanguage(params.language, params.appLanguage);
  if (!original.trim() || !targetLanguage) {
    return {
      prompt: original,
      language: 'prompt',
      changed: false,
      runtimeId: null,
      runtimeName: null,
      model: null,
    };
  }

  const [defaultRuntime, taskSettings] = await Promise.all([
    appSettingsService.get('defaultRuntime'),
    appSettingsService.get('tasks'),
  ]);
  // Same resolution as naming and summary: the user's chosen Agent supplies the
  // runtime, model and framing, falling back to the built-in preset.
  const promptRewriteAgent = await resolveSelectedUtilityAgent(
    taskSettings.promptRewriteAgentId,
    BUILTIN_AGENT_KEYS.promptRewrite
  );
  const runtimeId = promptRewriteAgent.runtimeId ?? params.runtimeId ?? defaultRuntime;
  const runtimeName = getRuntime(runtimeId)?.name ?? runtimeId;
  const model = promptRewriteAgent.model ?? params.model ?? null;
  const command = buildPromptRewriteCommand(
    runtimeId,
    buildPromptRewritePrompt({
      prompt: original,
      targetLanguage,
      systemPrompt: promptRewriteAgent.systemPrompt,
    }),
    model
  );
  if (!command) {
    throw new Error(`Prompt rewrite is not supported for ${runtimeName}.`);
  }

  const providerConfig = await runtimeOverrideSettings.getItem(runtimeId);
  const startedAt = Date.now();
  const result = await runAgentCli({
    ...command,
    cwd: resolvePromptRewriteCwd(params.projectId),
    env: {
      ...buildExternalToolEnv(resolveRuntimeBaseEnv(process.env, providerConfig, runtimeId)),
      ...resolveRuntimeEnv(providerConfig, { runtimeId }),
    },
    timeoutMs: PROMPT_REWRITE_TIMEOUT_MS,
    runtimeName,
    purpose: 'prompt-rewrite',
    model,
    metadata: {
      targetLanguage,
      source: params.language,
      ...(promptRewriteAgent.agentId ? { agentId: promptRewriteAgent.agentId } : {}),
      ...(promptRewriteAgent.agentName ? { agent: promptRewriteAgent.agentName } : {}),
    },
  });
  const rewritten = cleanRewrittenPrompt(extractAgentMessageText(result.stdout));
  if (!rewritten) throw new Error('Prompt rewrite returned an empty prompt.');

  log.info('[prompt-rewrite] completed', {
    runtimeId,
    targetLanguage,
    inputChars: original.length,
    outputChars: rewritten.length,
    stderrChars: result.stderrChars,
    durationMs: Date.now() - startedAt,
  });

  return {
    prompt: rewritten,
    language: targetLanguage,
    changed: rewritten !== original,
    runtimeId,
    runtimeName,
    model,
  };
}

function buildPromptRewriteCommand(
  runtimeId: RuntimeId,
  prompt: string,
  model: string | null
): PromptRewriteCommand | null {
  const modelArgs = model?.trim() ? ['--model', model.trim()] : [];
  if (runtimeId === 'claude') {
    return {
      command: 'claude',
      args: ['--print', '--output-format', 'text', '--no-session-persistence', ...modelArgs],
      stdin: prompt,
    };
  }
  if (runtimeId === 'codex') {
    return {
      command: 'codex',
      args: [
        'exec',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        ...modelArgs,
        '--json',
        '-',
      ],
      stdin: prompt,
    };
  }
  return null;
}

function resolvePromptRewriteCwd(projectId?: string | null): string {
  const project = projectId ? projectManager.getProject(projectId) : null;
  if (project?.ctx.supportsLocalSpawn) return project.repoPath;
  return process.cwd();
}
