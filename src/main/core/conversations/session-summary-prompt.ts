import { basename } from 'node:path';
import type { SessionSummaryScope, SessionTranscriptMessage } from '@shared/conversations';
import type { TaskOutputLanguage } from '@shared/project-settings';
import type { SummaryContext } from '@shared/session-summary';

const MAX_TRANSCRIPT_CHARS = 8_000;
const MAX_TRANSCRIPT_ANCHOR_CHARS = 2_000;
const MAX_SUMMARY_CHARS = 800;
/** `recent` is a one-line progress note: ~40 CJK chars, plus slack for ASCII. */
const MAX_RECENT_SUMMARY_CHARS = 60;
const SKILL_BLOCK_OPEN = '<skill>';
const SKILL_BLOCK_CLOSE = '</skill>';
const SKILL_NAME_OPEN = '<name>';
const SKILL_NAME_CLOSE = '</name>';

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
  const normalizedMessages = messages
    .map((message) => ({ ...message, text: normalizeTranscriptMessageText(message.text) }))
    .filter((message) => message.text)
    .filter((message) => (message.role === 'assistant' ? context.assistant : context.user));
  if (normalizedMessages.length === 0) return null;

  const projectLine = context.project ? `Project: ${basename(cwd)} @ ${cwd}` : null;
  const transcriptSelection = buildTranscriptSelection(normalizedMessages);
  const normalizedPreviousSummary =
    scope === 'global' && previousSummary?.trim() ? previousSummary.trim() : null;
  const basePrompt = buildSummaryPrompt(
    transcriptSelection.transcript,
    runtime.language,
    scope,
    projectLine,
    normalizedPreviousSummary
  );
  const prompt = runtime.systemPrompt.trim()
    ? `${runtime.systemPrompt.trim()}\n\n${basePrompt}`
    : basePrompt;

  return {
    messages: transcriptSelection.messages,
    transcript: transcriptSelection.transcript,
    transcriptTruncated: transcriptSelection.truncated,
    projectLine,
    previousSummary: normalizedPreviousSummary,
    prompt,
  };
}

function normalizeTranscriptMessageText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith(SKILL_BLOCK_OPEN) || !trimmed.endsWith(SKILL_BLOCK_CLOSE)) {
    return trimmed;
  }

  const skillNames: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (/\s/.test(trimmed[cursor] ?? '')) cursor += 1;
    if (!trimmed.startsWith(SKILL_BLOCK_OPEN, cursor)) return trimmed;
    const closeIndex = trimmed.indexOf(SKILL_BLOCK_CLOSE, cursor + SKILL_BLOCK_OPEN.length);
    if (closeIndex < 0) return trimmed;
    const blockEnd = closeIndex + SKILL_BLOCK_CLOSE.length;
    const name = extractSkillName(trimmed.slice(cursor, blockEnd));
    if (name) skillNames.push(name);
    cursor = blockEnd;
  }

  if (skillNames.length === 0) return '[Skill invocation metadata omitted]';
  return skillNames.map((name) => `[Skill invoked: $${name}]`).join('\n');
}

function extractSkillName(block: string): string | null {
  const start = block.indexOf(SKILL_NAME_OPEN);
  if (start < 0) return null;
  const valueStart = start + SKILL_NAME_OPEN.length;
  const end = block.indexOf(SKILL_NAME_CLOSE, valueStart);
  if (end < 0) return null;
  const value = block.slice(valueStart, end).trim();
  return /^[a-zA-Z0-9_:@./+-]{1,128}$/.test(value) ? value : null;
}

function buildTranscriptSelection(messages: SessionTranscriptMessage[]): {
  messages: SessionTranscriptMessage[];
  transcript: string;
  truncated: boolean;
} {
  const entries = messages.map((message, index) => formatTranscriptEntry(message, index));
  const rawTranscript = entries.join('\n\n');
  if (rawTranscript.length <= MAX_TRANSCRIPT_CHARS) {
    return { messages, transcript: rawTranscript, truncated: false };
  }

  if (messages.length === 1) {
    return {
      messages,
      transcript: clip(entries[0], MAX_TRANSCRIPT_CHARS),
      truncated: true,
    };
  }

  const anchor = clip(entries[0], MAX_TRANSCRIPT_ANCHOR_CHARS);
  const markerReserve = 96;
  const tailBudget = MAX_TRANSCRIPT_CHARS - anchor.length - markerReserve;
  const tailEntries: string[] = [];
  const tailMessageIndexes: number[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 1; index -= 1) {
    const separatorChars = tailEntries.length > 0 ? 2 : 0;
    const nextChars = entries[index].length + separatorChars;
    if (used + nextChars > tailBudget) {
      if (tailEntries.length === 0) {
        tailEntries.unshift(clipTranscriptEntryEnd(entries[index], tailBudget));
        tailMessageIndexes.unshift(index);
      }
      break;
    }
    tailEntries.unshift(entries[index]);
    tailMessageIndexes.unshift(index);
    used += nextChars;
  }

  const omittedCount = Math.max(0, messages.length - 1 - tailMessageIndexes.length);
  const omissionMarker =
    omittedCount > 0
      ? `[${omittedCount} earlier transcript message${omittedCount === 1 ? '' : 's'} omitted for length]`
      : '[Earlier transcript content clipped for length]';
  const transcript = [anchor, omissionMarker, ...tailEntries].join('\n\n');
  return {
    messages: [messages[0], ...tailMessageIndexes.map((index) => messages[index])],
    transcript: clip(transcript, MAX_TRANSCRIPT_CHARS),
    truncated: true,
  };
}

function formatTranscriptEntry(message: SessionTranscriptMessage, index: number): string {
  return `${index + 1}. ${message.role.toUpperCase()}: ${message.text}`;
}

function clipTranscriptEntryEnd(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const separator = value.indexOf(': ');
  const prefix = separator >= 0 ? value.slice(0, separator + 2) : '';
  const contentBudget = Math.max(0, maxChars - prefix.length - 1);
  if (contentBudget === 0) return prefix.slice(0, maxChars);
  return `${prefix}…${value.slice(-contentBudget)}`;
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
