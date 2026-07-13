import { basename } from 'node:path';
import type { SessionSummaryScope, SessionTranscriptMessage } from '@shared/conversations';
import type { TaskOutputLanguage } from '@shared/project-settings';
import type { SummaryContext } from '@shared/session-summary';

const MAX_PROMPT_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 800;
/** `recent` is a one-line progress note: ~40 CJK chars, plus slack for ASCII. */
const MAX_RECENT_SUMMARY_CHARS = 60;

export type SummaryPromptRuntime = {
  systemPrompt: string;
  language: TaskOutputLanguage;
  context: SummaryContext;
};

/** The fully assembled prompt and filtered messages for one summary run. */
export type SummaryDraft = {
  messages: SessionTranscriptMessage[];
  transcript: string;
  transcriptTruncated: boolean;
  projectLine: string | null;
  previousSummary: string | null;
  prompt: string;
};

/** Builds a summary prompt without running a provider CLI. */
export function buildSummaryDraft(
  runtime: SummaryPromptRuntime,
  cwd: string,
  messages: SessionTranscriptMessage[],
  scope: SessionSummaryScope,
  previousSummary?: string | null
): SummaryDraft | null {
  const { context } = runtime;
  const transcriptMessages = messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text)
    .filter((message) => (message.role === 'assistant' ? context.assistant : context.user));
  if (transcriptMessages.length === 0) return null;

  const projectLine = context.project ? `Project: ${basename(cwd)} @ ${cwd}` : null;
  const rawTranscript = transcriptMessages
    .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${message.text}`)
    .join('\n\n');
  const transcript = clip(rawTranscript, MAX_PROMPT_CHARS);
  const normalizedPreviousSummary =
    scope === 'global' && previousSummary?.trim() ? previousSummary.trim() : null;
  const basePrompt = buildSummaryPrompt(
    transcript,
    runtime.language,
    scope,
    projectLine,
    normalizedPreviousSummary
  );
  const prompt = runtime.systemPrompt.trim()
    ? `${runtime.systemPrompt.trim()}\n\n${basePrompt}`
    : basePrompt;

  return {
    messages: transcriptMessages,
    transcript,
    transcriptTruncated: transcript.length < rawTranscript.length,
    projectLine,
    previousSummary: normalizedPreviousSummary,
    prompt,
  };
}

export function normalizeGeneratedSummaryText(value: string, scope: SessionSummaryScope): string {
  const stripped = value
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!stripped) return '';

  if (scope === 'recent') {
    return firstSentence(stripped)
      .replace(/^[-*+\d.)\s]+/, '')
      .slice(0, MAX_RECENT_SUMMARY_CHARS)
      .trim();
  }

  const compact = stripped.replace(/\n{3,}/g, '\n\n').trim();
  return clipAtReadableBoundary(compact, MAX_SUMMARY_CHARS);
}

function buildSummaryPrompt(
  transcript: string,
  language: string,
  scope: SessionSummaryScope,
  projectLine: string | null,
  previousSummary: string | null
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
    'Output ONLY the summary text - no preamble, no meta commentary, no "here is the summary".',
    'Do not explore the repository or run tools; summarize purely from the transcript excerpt below.',
    'Plain text only, no markdown fences.',
    languageRule,
  ];
  const scopeRules =
    scope === 'recent'
      ? [
          'State the CURRENT progress of this session in a single, plain sentence.',
          'Output ONE short sentence. Hard limit: at most 40 Chinese characters, or about 30 English words.',
          'No file paths, commands, lists, or implementation detail. Avoid "the user asked" framing.',
          'If there is only a request and no progress yet, state what is being worked on.',
        ]
      : previousSummary
        ? [
            'You are updating a concise delivery summary for a coding session.',
            'Use the existing summary as the baseline and the new transcript messages as an increment.',
            'Keep useful facts, add concrete completed changes, and remove stale speculation.',
            'Optimize for reuse as commit-message and changelog context.',
            'Hard limit: at most 6 short bullets, 400 Chinese characters, or 120 English words.',
          ]
        : [
            'You are writing a concise delivery summary for a coding session.',
            'Cover the user goal, concrete implementation progress, and verification or release state.',
            'Optimize for reuse as commit-message and changelog context.',
            'Prefer transcript facts. Do not invent files, tests, or outcomes.',
            'Hard limit: at most 6 short bullets, 400 Chinese characters, or 120 English words.',
          ];

  return [
    ...scopeRules,
    ...common,
    '',
    ...(projectLine ? [projectLine, ''] : []),
    ...(previousSummary ? ['Existing summary:', previousSummary, ''] : []),
    scope === 'recent'
      ? 'Most recent transcript messages (in order):'
      : previousSummary
        ? 'New transcript messages since the existing summary (in order):'
        : 'Transcript messages in the session (in order):',
    transcript,
  ].join('\n');
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function firstSentence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^[^。！？.!?\n]*[。！？.!?]?/);
  return (match?.[0] ?? trimmed).trim();
}

function clipAtReadableBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const clipped = value.slice(0, maxChars);
  const boundary = Math.max(
    clipped.lastIndexOf('\n'),
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
    clipped.lastIndexOf('.'),
    clipped.lastIndexOf('!'),
    clipped.lastIndexOf('?')
  );
  return (boundary > maxChars * 0.6 ? clipped.slice(0, boundary + 1) : clipped).trim();
}
