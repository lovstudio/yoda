import { readFile } from 'node:fs/promises';
import type {
  MobileSessionTranscriptAgentPhase,
  MobileSessionTranscriptBlock,
} from '@shared/mobile-api';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';
import { IncrementalJsonlCursor } from './incremental-jsonl-cursor';

const MAX_TOOL_CONTENT_CHARS = 16 * 1024;
const INTERACTIVE_TOOL_NAMES = new Set(['AskUserQuestion', 'ExitPlanMode']);
const MAX_CACHED_TRANSCRIPTS = 8;
/**
 * Retained block content per session. Keeping a cursor means keeping its
 * accumulator, so this is resident rather than transient: the bound is what
 * stops eight long sessions from pinning the whole history in the main process.
 *
 * Four times the 240k-char cap every reader applies to its own response — wide
 * enough that trimming can never drop a block a caller would have rendered, and
 * narrow enough that the worst case stays a few megabytes per session.
 */
const MAX_RETAINED_CONTENT_CHARS = 1024 * 1024;

type TranscriptAccumulator = {
  blocks: MobileSessionTranscriptBlock[];
  /**
   * Monotonic block counter. Block ids embed it, so it must keep rising after a
   * trim instead of falling back to `blocks.length` and reissuing a used id.
   */
  nextIndex: number;
  retainedContentChars: number;
};

type ReaderOptions = {
  chunkBytes?: number;
  maxCacheEntries?: number;
  maxRetainedContentChars?: number;
  /** Read-work probe used by focused tests and runtime diagnostics. */
  onRead?: (filePath: string, position: number, length: number) => void;
};

/**
 * Parses Claude session transcripts through a byte cursor: a live turn appends
 * to a file that is routinely tens of megabytes, and the change feed invalidates
 * several times a second, so re-deriving the unchanged prefix on every read
 * costs a real fraction of a core. Only rows appended since the previous read
 * are parsed; the derived tool-status and compaction passes still run over the
 * retained blocks, which is array work rather than JSON work.
 */
export class ClaudeTranscriptReader {
  private readonly cursor: IncrementalJsonlCursor<TranscriptAccumulator>;

  constructor(options: ReaderOptions = {}) {
    const maxRetainedContentChars = Math.max(
      0,
      Math.floor(options.maxRetainedContentChars ?? MAX_RETAINED_CONTENT_CHARS)
    );
    this.cursor = new IncrementalJsonlCursor<TranscriptAccumulator>({
      createPayload: () => ({ blocks: [], nextIndex: 0, retainedContentChars: 0 }),
      commitLine: (accumulator, line) => {
        appendClaudeTranscriptLine(accumulator, line);
        trimRetainedBlocks(accumulator, maxRetainedContentChars);
      },
      maxCacheEntries: options.maxCacheEntries ?? MAX_CACHED_TRANSCRIPTS,
      ...(options.chunkBytes === undefined ? {} : { chunkBytes: options.chunkBytes }),
      ...(options.onRead ? { onRead: options.onRead } : {}),
    });
  }

  /** Resolves to null when the transcript is unreadable or holds nothing renderable. */
  async readFile(filePath: string): Promise<MobileSessionTranscriptBlock[] | null> {
    let accumulator: TranscriptAccumulator;
    try {
      accumulator = (await this.cursor.read(filePath)).payload;
    } catch {
      return null;
    }

    const transcript = deriveClaudeTranscript(accumulator.blocks);
    return transcript.length > 0 ? transcript : null;
  }

  clear(filePath?: string): void {
    this.cursor.clear(filePath);
  }
}

const claudeTranscriptReader = new ClaudeTranscriptReader();

export function loadClaudeTranscript({
  cwd,
  sessionId,
}: {
  cwd: string;
  sessionId: string;
}): Promise<MobileSessionTranscriptBlock[] | null> {
  return claudeTranscriptReader.readFile(resolveClaudeTranscriptPath(cwd, sessionId));
}

/**
 * Whole-history read for one-off consumers that must not drop earlier turns —
 * today the public session share. The cached reader keeps only a resident window
 * (`MAX_RETAINED_CONTENT_CHARS`) because it is polled several times a second, so
 * a share cannot go through it: it parses the file directly, once, uncached.
 */
export async function loadFullClaudeTranscript({
  cwd,
  sessionId,
}: {
  cwd: string;
  sessionId: string;
}): Promise<MobileSessionTranscriptBlock[] | null> {
  const raw = await readFile(resolveClaudeTranscriptPath(cwd, sessionId), 'utf8');
  const transcript = parseClaudeTranscript(raw);
  return transcript.length > 0 ? transcript : null;
}

export function parseClaudeTranscript(raw: string): MobileSessionTranscriptBlock[] {
  const accumulator: TranscriptAccumulator = { blocks: [], nextIndex: 0, retainedContentChars: 0 };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    appendClaudeTranscriptLine(accumulator, line);
  }
  return deriveClaudeTranscript(accumulator.blocks);
}

function appendClaudeTranscriptLine(accumulator: TranscriptAccumulator, line: string): void {
  const row = safeParse(line);
  if (!row) return;
  if (row.isSidechain === true || row.isMeta === true) return;
  if (row.subtype === 'stop_hook_summary') return;

  const message = objectValue(row.message);
  const role = nullableString(message?.role);
  const produced =
    row.type === 'user' && role === 'user'
      ? extractUserBlocks(message?.content, row, accumulator.nextIndex)
      : row.type === 'assistant' && role === 'assistant'
        ? extractAssistantBlocks(message?.content, row, accumulator.nextIndex)
        : [];

  for (const block of produced) {
    accumulator.blocks.push(block);
    accumulator.retainedContentChars += block.content.length;
  }
  accumulator.nextIndex += produced.length;
}

function trimRetainedBlocks(accumulator: TranscriptAccumulator, maxContentChars: number): void {
  if (accumulator.retainedContentChars <= maxContentChars) return;

  let dropCount = 0;
  let retained = accumulator.retainedContentChars;
  while (dropCount < accumulator.blocks.length && retained > maxContentChars) {
    retained -= accumulator.blocks[dropCount]?.content.length ?? 0;
    dropCount += 1;
  }
  if (dropCount === 0) return;
  accumulator.blocks.splice(0, dropCount);
  accumulator.retainedContentChars = retained;
}

/**
 * Derives the renderable transcript from retained rows. Both passes need the
 * whole retained window — an interactive tool call is resolved by a result that
 * can arrive many rows later — so they run per read rather than per appended row.
 */
function deriveClaudeTranscript(
  blocks: MobileSessionTranscriptBlock[]
): MobileSessionTranscriptBlock[] {
  return compactIncrementalAssistantBlocks(resolveClaudeToolStatuses(blocks));
}

function extractUserBlocks(
  content: unknown,
  row: Record<string, unknown>,
  baseIndex: number
): MobileSessionTranscriptBlock[] {
  if (typeof content === 'string') {
    const text = cleanText(content);
    return text
      ? [
          {
            id: transcriptId(row, baseIndex, 'user'),
            role: 'user',
            title: 'You',
            timestamp: nullableString(row.timestamp),
            format: 'markdown',
            content: text,
          },
        ]
      : [];
  }

  if (!Array.isArray(content)) return [];

  const out: MobileSessionTranscriptBlock[] = [];
  const textParts: string[] = [];

  const flushText = () => {
    const text = cleanText(textParts.join('\n\n'));
    textParts.length = 0;
    if (!text) return;
    out.push({
      id: transcriptId(row, baseIndex + out.length, 'user'),
      role: 'user',
      title: 'You',
      timestamp: nullableString(row.timestamp),
      format: 'markdown',
      content: text,
    });
  };

  for (const item of content) {
    const block = objectValue(item);
    if (!block) continue;

    if (block.type === 'text' && typeof block.text === 'string') {
      const text = cleanText(block.text);
      if (text) textParts.push(text);
      continue;
    }

    if (block.type === 'tool_result') {
      flushText();
      const contentText = extractToolResultContent(block.content);
      if (!contentText) continue;
      const isError = block.is_error === true;
      const toolCallId = nullableString(block.tool_use_id);
      out.push({
        id: transcriptId(row, baseIndex + out.length, 'tool'),
        role: 'tool',
        title: isError ? 'Tool error' : 'Tool output',
        ...(toolCallId ? { toolCallId } : {}),
        timestamp: nullableString(row.timestamp),
        format: 'code',
        content: contentText,
      });
    }
  }

  flushText();
  return out;
}

function extractAssistantBlocks(
  content: unknown,
  row: Record<string, unknown>,
  baseIndex: number
): MobileSessionTranscriptBlock[] {
  const agentPhase = claudeAgentPhase(row);
  if (typeof content === 'string') {
    const text = cleanText(content);
    return text
      ? [
          {
            id: transcriptId(row, baseIndex, 'assistant'),
            role: 'assistant',
            agentPhase,
            title: 'Claude',
            timestamp: nullableString(row.timestamp),
            format: 'markdown',
            content: text,
          },
        ]
      : [];
  }

  if (!Array.isArray(content)) return [];

  const out: MobileSessionTranscriptBlock[] = [];
  const textParts: string[] = [];

  const flushText = () => {
    const text = cleanText(textParts.join('\n\n'));
    textParts.length = 0;
    if (!text) return;
    out.push({
      id: transcriptId(row, baseIndex + out.length, 'assistant'),
      role: 'assistant',
      agentPhase,
      title: 'Claude',
      timestamp: nullableString(row.timestamp),
      format: 'markdown',
      content: text,
    });
  };

  for (const item of content) {
    const block = objectValue(item);
    if (!block) continue;

    if (block.type === 'text' && typeof block.text === 'string') {
      const text = cleanText(block.text);
      if (text) textParts.push(text);
      continue;
    }

    if (block.type === 'tool_use') {
      flushText();
      const name = nullableString(block.name) ?? 'tool';
      const toolCallId = nullableString(block.id);
      const isInteractive = INTERACTIVE_TOOL_NAMES.has(name);
      const input = formatJsonLike(block.input);
      out.push({
        id: transcriptId(row, baseIndex + out.length, 'tool'),
        role: 'tool',
        title: `Tool · ${name}`,
        ...(isInteractive ? { toolStatus: 'running' as const } : {}),
        ...(isInteractive && toolCallId ? { toolCallId } : {}),
        timestamp: nullableString(row.timestamp),
        format: 'code',
        content: input ? truncate(input, MAX_TOOL_CONTENT_CHARS) : name,
      });
      continue;
    }
  }

  flushText();
  return out;
}

function resolveClaudeToolStatuses(
  blocks: MobileSessionTranscriptBlock[]
): MobileSessionTranscriptBlock[] {
  const resolvedToolCallIds = new Set(
    blocks
      .filter((block) => block.title === 'Tool output' && block.toolCallId)
      .map((block) => block.toolCallId)
  );

  if (resolvedToolCallIds.size === 0) return blocks;

  return blocks.map((block) =>
    block.toolStatus === 'running' && block.toolCallId && resolvedToolCallIds.has(block.toolCallId)
      ? { ...block, toolStatus: 'completed' as const }
      : block
  );
}

function extractToolResultContent(content: unknown): string | null {
  if (typeof content === 'string') return cleanText(truncate(content, MAX_TOOL_CONTENT_CHARS));
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const item of content) {
    const block = objectValue(item);
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = cleanText(block.text);
      if (text) parts.push(text);
    }
  }

  return cleanText(truncate(parts.join('\n'), MAX_TOOL_CONTENT_CHARS));
}

function compactIncrementalAssistantBlocks(
  blocks: MobileSessionTranscriptBlock[]
): MobileSessionTranscriptBlock[] {
  const compacted: MobileSessionTranscriptBlock[] = [];
  for (const block of blocks) {
    const previous = compacted.at(-1);
    if (
      previous &&
      previous.role === 'assistant' &&
      block.role === 'assistant' &&
      previous.agentPhase === block.agentPhase &&
      (previous.format === 'markdown' || previous.format === 'plain') &&
      (block.format === 'markdown' || block.format === 'plain')
    ) {
      previous.content = `${previous.content}\n\n${block.content}`;
      previous.format =
        previous.format === 'markdown' || block.format === 'markdown' ? 'markdown' : 'plain';
    } else {
      compacted.push({ ...block });
    }
  }
  return compacted;
}

function claudeAgentPhase(row: Record<string, unknown>): MobileSessionTranscriptAgentPhase {
  const message = objectValue(row.message);
  const stopReason = nullableString(message?.stop_reason);
  return stopReason && stopReason !== 'tool_use' ? 'final' : 'commentary';
}

function cleanText(value: string): string | null {
  const text = stripWrapperTags(value)
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text : null;
}

function stripWrapperTags(text: string): string {
  return text
    .replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>\s*/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>\s*/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '');
}

function transcriptId(row: Record<string, unknown>, index: number, fallback: string): string {
  const base = nullableString(row.uuid) ?? nullableString(row.timestamp) ?? 'no-time';
  return `${base}-${fallback}-${index}`;
}

function formatJsonLike(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[... truncated ${value.length - maxChars} chars]`;
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return objectValue(parsed);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown): string | null {
  const str = typeof value === 'string' ? value.trim() : null;
  return str ? str : null;
}
