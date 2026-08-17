import type { AiInvocationLogRecord } from '@shared/ai-logs';

/**
 * Redaction and copy-for-debug helpers for the AI invocation log. Debug payloads
 * leave the app through the clipboard, so secrets are stripped here and prompt /
 * output bodies are never included — only their sizes.
 */

const MAX_DEBUG_COMMAND_CHARS = 4_000;
const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_FIELD_PATTERN =
  /(?:api[-_]?key|authorization|credential|password|private[-_]?key|secret|token)/i;
const ALWAYS_COLLAPSED_COMMAND_CONFIGS = new Set(['developer_instructions', 'notify']);
const COLLAPSED_COMMAND_VALUE_THRESHOLD = 160;

type CommandConfigSegment = {
  key: string;
  valueStart: number;
  valueEnd: number;
};

function findCommandConfigValueEnd(command: string, start: number): number {
  const opener = command[start];
  if (opener === '"' || opener === "'") {
    for (let index = start + 1; index < command.length; index += 1) {
      if (command[index] === '\\') {
        index += 1;
      } else if (command[index] === opener) {
        return index + 1;
      }
    }
    return command.length;
  }

  const closer = opener === '[' ? ']' : opener === '{' ? '}' : undefined;
  if (closer) {
    let depth = 0;
    let quote: '"' | "'" | undefined;
    for (let index = start; index < command.length; index += 1) {
      const character = command[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = undefined;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === opener) {
        depth += 1;
      } else if (character === closer) {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
    }
    return command.length;
  }

  const nextWhitespace = command.slice(start).search(/\s/);
  return nextWhitespace === -1 ? command.length : start + nextWhitespace;
}

function findCommandConfigSegments(command: string): CommandConfigSegment[] {
  const segments: CommandConfigSegment[] = [];
  const configPattern = /(?:^|\s)-c\s+([A-Za-z0-9_.-]+)=/g;
  let match: RegExpExecArray | null;
  while ((match = configPattern.exec(command))) {
    const valueStart = configPattern.lastIndex;
    const valueEnd = findCommandConfigValueEnd(command, valueStart);
    segments.push({ key: match[1], valueStart, valueEnd });
    configPattern.lastIndex = Math.max(valueEnd, configPattern.lastIndex);
  }
  return segments;
}

function splitCommandWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\' && index + 1 < command.length) {
      current += character + command[index + 1];
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      if (!quote) quote = character;
      else if (quote === character) quote = undefined;
      current += character;
      continue;
    }
    if (/\s/.test(character) && !quote) {
      if (current) words.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) words.push(current);
  return words;
}

export function buildCompactCommand(
  command: string,
  collapsedValue: (characterCount: number) => string = (count) => `<collapsed:${count}-chars>`
): string {
  const replacements = new Map<string, string>();
  let compactSource = '';
  let cursor = 0;

  for (const [index, segment] of findCommandConfigSegments(command).entries()) {
    const value = command.slice(segment.valueStart, segment.valueEnd);
    if (
      !ALWAYS_COLLAPSED_COMMAND_CONFIGS.has(segment.key) &&
      value.length <= COLLAPSED_COMMAND_VALUE_THRESHOLD
    ) {
      continue;
    }
    const marker = `__YODA_COMMAND_VALUE_${index}__`;
    compactSource += command.slice(cursor, segment.valueStart) + marker;
    cursor = segment.valueEnd;
    replacements.set(marker, collapsedValue(value.length));
  }
  compactSource += command.slice(cursor);

  const words = splitCommandWords(compactSource).map((word) => {
    let resolved = word;
    for (const [marker, replacement] of replacements) {
      resolved = resolved.replace(marker, replacement);
    }
    return resolved;
  });
  if (words.length <= 1) return command;

  const lines = [words[0]];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (word.startsWith('-') && next && !next.startsWith('-')) {
      lines.push(`  ${word} ${next}`);
      index += 1;
    } else {
      lines.push(`  ${word}`);
    }
  }
  return lines.join('\n');
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(\bBearer\s+)[^\s"'\\]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/((?:authorization|x-api-key|x-yoda-token)\s*:\s*)[^\s"'\\]+/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /((?:api[-_]?key|credential|password|private[-_]?key|secret|token)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^\s,"';\\]+/gi,
      `$1${REDACTED_VALUE}`
    );
}

function clipDebugCommand(value: string | null): string | null {
  if (!value) return null;
  const redacted = redactSensitiveText(value);
  if (redacted.length <= MAX_DEBUG_COMMAND_CHARS) return redacted;
  return `${redacted.slice(0, MAX_DEBUG_COMMAND_CHARS)}\n… [clipped ${redacted.length - MAX_DEBUG_COMMAND_CHARS} chars]`;
}

function sanitizeMetadata(metadata: Record<string, string> | null): Record<string, string> | null {
  if (!metadata) return null;
  return Object.fromEntries(
    Object.entries(metadata)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        SENSITIVE_FIELD_PATTERN.test(key) ? REDACTED_VALUE : redactSensitiveText(value),
      ])
  );
}

export function buildAiLogDebugInformation(record: AiInvocationLogRecord): string {
  return JSON.stringify(
    {
      schema: 'yoda-ai-log-debug/v1',
      log: {
        id: record.id,
        purpose: record.purpose,
        mode: record.mode,
        runtime: record.runtime,
        model: record.model,
        status: record.status,
        command: clipDebugCommand(record.command),
        error: record.error ? redactSensitiveText(record.error) : null,
        metadata: sanitizeMetadata(record.metadata),
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        durationMs: record.durationMs,
      },
      omittedContent: {
        promptChars: record.prompt?.length ?? 0,
        outputChars: record.output?.length ?? 0,
      },
    },
    null,
    2
  );
}
