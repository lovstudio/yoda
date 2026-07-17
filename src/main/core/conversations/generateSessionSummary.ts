import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type { SessionSummary, SessionSummaryScope } from '@shared/conversations';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveSelectedUtilityAgent } from '@main/core/agents-config/builtin-agent-resolver';
import { getProjectComposerDefaults } from '@main/core/projects/settings/composer-default-overrides';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveRuntimeBaseEnv, resolveRuntimeEnv } from './impl/runtime-env';
import {
  normalizeGeneratedSummaryText,
  type SummaryDraft,
  type SummaryPromptRuntime,
} from './session-summary-prompt';

const SUMMARY_TIMEOUT_MS = 90_000;

type SummaryCommand = { command: string; args: string[]; stdin: string };

export type SessionSummaryGenerationResult = {
  summary: SessionSummary | null;
  error: string | null;
};

/**
 * The provider/model/prompt a summary should run on. Resolved from the
 * configured summary Agent (NOT the session's runtime) so summaries keep
 * working even when the session's own runtime is no longer usable.
 */
export interface ResolvedSummaryRuntime extends SummaryPromptRuntime {
  runtimeId: RuntimeId;
  runtimeName: string;
  model: string | null;
}

/**
 * Resolves which Agent drives summary generation, plus the per-scope context
 * toggles. Provider comes entirely from the selected summary Agent (falling
 * back to the global default Agent when it pins none), independent of the
 * session's own — possibly dead — runtime.
 */
export async function resolveSummaryRuntime(
  scope: SessionSummaryScope,
  projectId?: string | null
): Promise<ResolvedSummaryRuntime> {
  const [taskSettings, defaultRuntime, composerDefaults] = await Promise.all([
    appSettingsService.get('tasks'),
    appSettingsService.get('defaultRuntime'),
    getProjectComposerDefaults(projectId),
  ]);
  const summaryAgent = await resolveSelectedUtilityAgent(
    taskSettings.summaryAgentId,
    BUILTIN_AGENT_KEYS.summary
  );
  const runtimeId = summaryAgent.runtimeId ?? defaultRuntime;
  return {
    runtimeId,
    runtimeName: getRuntime(runtimeId)?.name ?? runtimeId,
    model: summaryAgent.model,
    systemPrompt: summaryAgent.systemPrompt,
    language: composerDefaults?.summaryLanguage ?? taskSettings.summaryLanguage,
    context:
      scope === 'recent' ? taskSettings.summaryContextRecent : taskSettings.summaryContextGlobal,
  };
}

/**
 * Provider-backed delivery summary. The app has no LLM API client, so it runs
 * the configured summary provider CLI non-interactively on the selected
 * transcript messages.
 *
 * This uses its own read-only one-shot command rather than the configured
 * `namingCommand`: summary is a pure text task over the messages below, so a
 * plain `--print` (Claude) / `exec --sandbox read-only` (Codex) run is fast and
 * never touches the repo.
 */
export async function generateSessionSummary(
  runtime: ResolvedSummaryRuntime,
  cwd: string,
  draft: SummaryDraft,
  scope: SessionSummaryScope,
  onDelta?: (delta: string) => void
): Promise<SessionSummaryGenerationResult> {
  if (runtime.language === 'skip') {
    return { summary: null, error: 'Session summary generation is disabled.' };
  }
  const { runtimeId, runtimeName } = runtime;
  const { messages: transcriptMessages, prompt } = draft;

  const startedAt = Date.now();
  // The summary Agent supplies the provider, model, language and base framing —
  // see resolveSummaryRuntime. Provider is the Agent's own, never the session's.
  const providerConfig = await runtimeOverrideSettings.getItem(runtimeId);
  const command = buildSummaryCommand(runtimeId, prompt, runtime.model);
  if (!command) {
    return {
      summary: null,
      error: `Session summary generation is not supported for ${runtimeName}.`,
    };
  }

  try {
    const cliStartedAt = Date.now();
    const result = await runAgentCli({
      ...command,
      cwd,
      env: {
        ...buildExternalToolEnv(resolveRuntimeBaseEnv(process.env, providerConfig, runtimeId)),
        ...resolveRuntimeEnv(providerConfig, { runtimeId }),
      },
      timeoutMs: SUMMARY_TIMEOUT_MS,
      runtimeName,
      purpose: 'session-summary',
      model: runtime.model,
      metadata: { scope },
      onDelta,
    });
    const cliDurationMs = Date.now() - cliStartedAt;
    const text = normalizeGeneratedSummaryText(extractAgentMessageText(result.stdout), scope);
    if (!text) {
      return { summary: null, error: `${runtimeName} returned no summary text.` };
    }
    log.info('[session-summary] generate timing', {
      runtimeId,
      scope,
      command: command.command,
      messageCount: transcriptMessages.length,
      promptChars: prompt.length,
      outputChars: text.length,
      stderrChars: result.stderrChars,
      cliDurationMs,
      totalDurationMs: Date.now() - startedAt,
    });
    return {
      summary: { text, timestamp: new Date().toISOString() },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('generateSessionSummary: failed', {
      runtimeId,
      scope,
      messageCount: transcriptMessages.length,
      totalDurationMs: Date.now() - startedAt,
      error: message,
    });
    return { summary: null, error: message };
  }
}

/**
 * Fast, read-only one-shot summary command per provider. Returns null for
 * providers without a non-interactive print mode.
 */
function buildSummaryCommand(
  runtimeId: RuntimeId,
  prompt: string,
  model: string | null
): SummaryCommand | null {
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
