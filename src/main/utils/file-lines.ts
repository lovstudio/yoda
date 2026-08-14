import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_LINE_CHARS = 2 * 1024 * 1024;

/**
 * Iterate a UTF-8 text file without materializing it in memory. Oversized
 * lines are discarded as a unit; JSONL transcripts can contain image/tool
 * payload rows hundreds of megabytes long that no startup reader should parse.
 */
export async function* iterateFileLines(
  path: string,
  options: { chunkBytes?: number; maxLineChars?: number; maxReadBytes?: number } = {}
): AsyncGenerator<string> {
  const input = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
    ...(options.maxReadBytes === undefined ? {} : { end: Math.max(0, options.maxReadBytes - 1) }),
  });
  const maxLineChars = options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  let buffer = '';
  let discardingOversizedLine = false;
  try {
    for await (const chunk of input) {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        if (!discardingOversizedLine && newline <= maxLineChars) {
          yield buffer.slice(0, newline);
        }
        buffer = buffer.slice(newline + 1);
        discardingOversizedLine = false;
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > maxLineChars) {
        buffer = '';
        discardingOversizedLine = true;
      }
    }
    if (!discardingOversizedLine && buffer) yield buffer;
  } finally {
    input.destroy();
  }
}

export async function readFirstFileLine(path: string): Promise<string | null> {
  for await (const line of iterateFileLines(path)) return line;
  return null;
}

/**
 * Read at most the last `bytes` of a file. Used for log-shaped files whose tail
 * is the interesting part (append-only outputs, cumulative rollout events).
 */
export async function readFileTail(
  path: string,
  bytes: number
): Promise<{ text: string; truncated: boolean; totalSize: number }> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.toString('utf8'), truncated: start > 0, totalSize: size };
  } finally {
    await handle.close();
  }
}
