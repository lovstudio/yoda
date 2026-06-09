import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import type {
  ClaudeSessionPrompt,
  SessionSummary,
  SessionSummaryScope,
} from '@shared/conversations';
import { extractAgentMessageText, runAgentCli } from '@main/core/agent-cli/run-agent-cli';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { resolveProviderEnv } from './impl/provider-env';

const MAX_PROMPT_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 4_000;
const SUMMARY_TIMEOUT_MS = 90_000;

type SummaryCommand = { command: string; args: string[]; stdin: string };

/**
 * On-demand session summary, used only when the runtime never wrote a
 * compaction summary into the transcript. The app has no LLM API client, so it
 * runs the provider CLI non-interactively (one-shot print/exec mode) on the
 * conversation's user prompts.
 *
 * Unlike task naming, this deliberately does NOT use the configured
 * `namingCommand`: that runs Claude in `--permission-mode plan`, which makes it
 * explore the repo and emit planning preamble — slow (90s+) and noisy. A plain
 * `--print` run returns a clean summary in seconds.
 */
export async function generateSessionSummary(
  providerId: AgentProviderId,
  cwd: string,
  prompts: ClaudeSessionPrompt[],
  scope: SessionSummaryScope
): Promise<SessionSummary | null> {
  const userPrompts = prompts.map((p) => p.text.trim()).filter(Boolean);
  if (userPrompts.length === 0) return null;

  const taskSettings = await appSettingsService.get('tasks');
  const prompt = buildSummaryPrompt(userPrompts, taskSettings.namingLanguage, scope);
  const command = buildSummaryCommand(providerId, prompt);
  if (!command) return null;

  const providerConfig = await providerOverrideSettings.getItem(providerId);
  const providerName = getProvider(providerId)?.name ?? providerId;

  try {
    const result = await runAgentCli({
      ...command,
      cwd,
      env: { ...buildExternalToolEnv(), ...resolveProviderEnv(providerConfig) },
      timeoutMs: SUMMARY_TIMEOUT_MS,
      providerName,
    });
    const text = extractAgentMessageText(result.stdout).slice(0, MAX_SUMMARY_CHARS).trim();
    if (!text) return null;
    return { text, timestamp: new Date().toISOString() };
  } catch (error) {
    log.warn('generateSessionSummary: failed', {
      providerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fast, read-only one-shot summary command per provider. Returns null for
 * providers without a non-interactive print mode.
 */
function buildSummaryCommand(providerId: AgentProviderId, prompt: string): SummaryCommand | null {
  if (providerId === 'claude') {
    return {
      command: 'claude',
      args: ['--print', '--output-format', 'text', '--no-session-persistence'],
      stdin: prompt,
    };
  }
  if (providerId === 'codex') {
    return {
      command: 'codex',
      args: ['exec', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '--json', '-'],
      stdin: prompt,
    };
  }
  return null;
}

function buildSummaryPrompt(
  userPrompts: string[],
  language: string,
  scope: SessionSummaryScope
): string {
  const languageRule =
    language === 'en'
      ? 'Write the summary in English.'
      : language === 'zh-CN'
        ? 'Write the summary in Simplified Chinese.'
        : 'Write the summary in the same language the user mostly used.';
  const transcript = clip(
    userPrompts.map((text, index) => `${index + 1}. ${text}`).join('\n'),
    MAX_PROMPT_CHARS
  );
  const common = [
    'Output ONLY the summary text — no preamble, no meta commentary, no "here is the summary".',
    'Do not explore the repository or run tools; summarize purely from the messages below.',
    'Plain text only, no markdown fences.',
    languageRule,
  ];
  const scopeRules =
    scope === 'recent'
      ? [
          'Summarize ONLY what the user is currently working on, based on their most recent messages.',
          'Be very short: one or two sentences. No history, no background.',
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
    scope === 'recent'
      ? 'Most recent user messages (in order):'
      : 'User messages in the session (in order):',
    transcript,
  ].join('\n');
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
