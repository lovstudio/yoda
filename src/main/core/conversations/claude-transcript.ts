import { readFile } from 'node:fs/promises';
import type { MobileSessionTranscriptBlock } from '@shared/mobile-api';
import { resolveClaudeTranscriptPath } from '@main/core/session-title/claude-title-source';

const MAX_TOOL_CONTENT_CHARS = 16 * 1024;

export async function loadClaudeTranscript({
  cwd,
  sessionId,
}: {
  cwd: string;
  sessionId: string;
}): Promise<MobileSessionTranscriptBlock[] | null> {
  let raw: string;
  try {
    raw = await readFile(resolveClaudeTranscriptPath(cwd, sessionId), 'utf8');
  } catch {
    return null;
  }

  const transcript = parseClaudeTranscript(raw);
  return transcript.length > 0 ? transcript : null;
}

export function parseClaudeTranscript(raw: string): MobileSessionTranscriptBlock[] {
  const blocks: MobileSessionTranscriptBlock[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const row = safeParse(line);
    if (!row) continue;
    if (row.isSidechain === true || row.isMeta === true) continue;
    if (row.subtype === 'stop_hook_summary') continue;

    const message = objectValue(row.message);
    const role = nullableString(message?.role);
    if (row.type === 'user' && role === 'user') {
      blocks.push(...extractUserBlocks(message?.content, row, blocks.length));
      continue;
    }

    if (row.type === 'assistant' && role === 'assistant') {
      for (const block of extractAssistantBlocks(message?.content, row, blocks.length)) {
        blocks.push(block);
      }
    }
  }

  return compactIncrementalAssistantBlocks(blocks);
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
      out.push({
        id: transcriptId(row, baseIndex + out.length, 'tool'),
        role: 'tool',
        title: isError ? 'Tool error' : 'Tool output',
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
  if (typeof content === 'string') {
    const text = cleanText(content);
    return text
      ? [
          {
            id: transcriptId(row, baseIndex, 'assistant'),
            role: 'assistant',
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
      const input = formatJsonLike(block.input);
      out.push({
        id: transcriptId(row, baseIndex + out.length, 'tool'),
        role: 'tool',
        title: `Tool · ${name}`,
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
