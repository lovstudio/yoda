import { basename } from 'node:path';
import { BUILTIN_AGENT_KEYS } from '@shared/builtin-agents';
import type {
  SessionSummary,
  SessionSummaryScope,
  SessionTranscriptMessage,
} from '@shared/conversations';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import type { SummaryContext } from '@shared/session-summary';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { resolveSelectedUtilityAgent } from '@main/core/agents-config/builtin-agent-resolver';
import { getProjectComposerDefaults } from '@main/core/projects/settings/composer-default-overrides';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveRuntimeBaseEnv, resolveRuntimeEnv } from './impl/runtime-env';

const MAX_PROMPT_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 4_000;
/** `recent` is a one-line progress note: ~40 CJK chars, plus slack for ASCII. */
const MAX_RECENT_SUMMARY_CHARS = 60;
const SUMMARY_TIMEOUT_MS = 90_000;

type SummaryCommand = { command: string; args: string[]; stdin: string };

/**
 * The provider/model/prompt a summary should run on. Resolved from the
 * configured summary Agent (NOT the session's runtime) so summaries keep
 * working even when the session's own runtime is no longer usable.
 */
export interface ResolvedSummaryRuntime {
  runtimeId: RuntimeId;
  runtimeName: string;
  model: string | null;
  systemPrompt: string;
  /** Output language for the summary: 'app' | 'prompt' | 'en' | 'zh-CN'. */
  language: string;
  /** Which transcript parts to feed (per-scope; see settings). */
  context: SummaryContext;
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
 * The fully assembled prompt for one summary run, exposed separately from
 * generation so the debug snapshot can capture exactly what will be sent.
 */
export type SummaryDraft = {
  /** Trimmed, role-filtered messages the summary covers. */
  messages: SessionTranscriptMessage[];
  /** The formatted (and possibly clipped) transcript excerpt fed to the model. */
  transcript: string;
  transcriptTruncated: boolean;
  /** Optional project framing line (context toggle `project`). */
  projectLine: string | null;
  /** The final prompt actually sent (Agent system prompt + base prompt). */
  prompt: string;
};

/**
 * Builds the summary prompt without running anything. Returns null when the
 * context toggles leave nothing to summarize.
 */
export function buildSummaryDraft(
  runtime: ResolvedSummaryRuntime,
  cwd: string,
  messages: SessionTranscriptMessage[],
  scope: SessionSummaryScope
): SummaryDraft | null {
  const { context } = runtime;
  const transcriptMessages = messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text)
    // Context toggles: drop roles the user excluded (recent defaults to
    // user-only for speed; global includes assistant too).
    .filter((message) => (message.role === 'assistant' ? context.assistant : context.user));
  if (transcriptMessages.length === 0) return null;

  const projectLine = context.project ? `Project: ${basename(cwd)} @ ${cwd}` : null;
  const rawTranscript = transcriptMessages
    .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.text}`)
    .join('\n\n');
  const transcript = clip(rawTranscript, MAX_PROMPT_CHARS);
  const basePrompt = buildSummaryPrompt(transcript, runtime.language, scope, projectLine);
  const prompt = runtime.systemPrompt.trim()
    ? `${runtime.systemPrompt.trim()}\n\n${basePrompt}`
    : basePrompt;
  return {
    messages: transcriptMessages,
    transcript,
    transcriptTruncated: transcript.length < rawTranscript.length,
    projectLine,
    prompt,
  };
}

/**
 * On-demand session summary, used only when the runtime never wrote a
 * compaction summary into the transcript. The app has no LLM API client, so it
 * runs the provider CLI non-interactively (one-shot print/exec mode) on the
 * conversation's user prompts.
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
): Promise<SessionSummary | null> {
  const { runtimeId, runtimeName } = runtime;
  const { messages: transcriptMessages, prompt } = draft;

  const startedAt = Date.now();
  // The summary Agent supplies the provider, model, language and base framing —
  // see resolveSummaryRuntime. Provider is the Agent's own, never the session's.
  const providerConfig = await runtimeOverrideSettings.getItem(runtimeId);
  const command = buildSummaryCommand(runtimeId, prompt, runtime.model);
  if (!command) return null;

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
    const maxChars = scope === 'recent' ? MAX_RECENT_SUMMARY_CHARS : MAX_SUMMARY_CHARS;
    // Backstop the prompt's length rule: keep one sentence for `recent`.
    const text = firstSentence(extractAgentMessageText(result.stdout), scope)
      .slice(0, maxChars)
      .trim();
    if (!text) return null;
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
    return { text, timestamp: new Date().toISOString() };
  } catch (error) {
    log.warn('generateSessionSummary: failed', {
      runtimeId,
      scope,
      messageCount: transcriptMessages.length,
      totalDurationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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

function buildSummaryPrompt(
  transcript: string,
  language: string,
  scope: SessionSummaryScope,
  projectLine: string | null
): string {
  const languageRule =
    language === 'en'
      ? 'Write the summary in English.'
      : language === 'zh-CN'
        ? 'Write the summary in Simplified Chinese.'
        : language === 'prompt'
          ? 'Write the summary in the same language the user mostly used.'
          : 'Write the summary in the application UI language when obvious; otherwise the language the user mostly used.';
  const common = [
    'Output ONLY the summary text — no preamble, no meta commentary, no "here is the summary".',
    'Do not explore the repository or run tools; summarize purely from the transcript excerpt below.',
    'Plain text only, no markdown fences.',
    languageRule,
  ];
  const recentLengthRule =
    'Output ONE short sentence. Hard limit: at most 40 Chinese characters, or ~30 words if writing in English. Do not exceed.';
  const scopeRules =
    scope === 'recent'
      ? [
          'State the CURRENT progress of this session in a single, plain sentence.',
          recentLengthRule,
          'No file paths, commands, lists, or implementation detail. No "the user asked / the assistant did" framing — just the state.',
          'If there is only a request and no progress yet, state what is being worked on, not that it is done.',
        ]
      : [
          'You are summarizing a whole coding session for someone about to resume the work.',
          'Cover the overall goal, what has been requested so far, and the likely current focus.',
          'Be concise: a few short paragraphs or bullet points.',
        ];
  return [
    ...scopeRules,
    ...common,
    '',
    ...(projectLine ? [projectLine, ''] : []),
    scope === 'recent'
      ? 'Most recent transcript messages (in order):'
      : 'Transcript messages in the session (in order):',
    transcript,
  ].join('\n');
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/**
 * For `recent`, keep only the first sentence as a backstop in case the model
 * ignores the one-sentence instruction. Splits on CJK and ASCII sentence-enders.
 */
function firstSentence(value: string, scope: SessionSummaryScope): string {
  const trimmed = value.trim();
  if (scope !== 'recent') return trimmed;
  const match = trimmed.match(/^[^。！？.!?\n]*[。！？.!?]?/);
  return (match?.[0] ?? trimmed).trim();
}
