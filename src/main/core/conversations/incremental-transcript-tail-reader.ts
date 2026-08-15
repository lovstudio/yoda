import { IncrementalJsonlCursor } from './incremental-jsonl-cursor';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

export interface IncrementalTranscriptTail {
  totalLines: number;
  lines: string[];
}

type TailPayload = {
  totalLines: number;
  tail: string[];
  tailStart: number;
};

type ReaderOptions = {
  chunkBytes?: number;
  maxCacheEntries?: number;
  /** Read-work probe used by focused tests and runtime diagnostics. */
  onRead?: (filePath: string, position: number, length: number) => void;
};

/**
 * Incrementally scans append-only JSONL transcripts while retaining only the
 * latest raw lines. File replacement and truncation rebuild the per-path state.
 */
export class IncrementalTranscriptTailReader {
  private readonly maxTailLines: number;
  private readonly cursor: IncrementalJsonlCursor<TailPayload>;

  constructor(maxTailLines: number, options: ReaderOptions = {}) {
    this.maxTailLines = Math.max(0, Math.floor(maxTailLines));
    this.cursor = new IncrementalJsonlCursor<TailPayload>({
      createPayload: () => ({ totalLines: 0, tail: [], tailStart: 0 }),
      commitLine: (payload, line) => this.retainLine(payload, line),
      chunkBytes: Math.max(1, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK_BYTES)),
      maxCacheEntries: Math.max(
        1,
        Math.floor(options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES)
      ),
      ...(options.onRead ? { onRead: options.onRead } : {}),
    });
  }

  async read(filePath: string): Promise<IncrementalTranscriptTail> {
    const { payload, pendingLine } = await this.cursor.read(filePath);
    return this.snapshot(payload, pendingLine);
  }

  clear(filePath?: string): void {
    this.cursor.clear(filePath);
  }

  private retainLine(payload: TailPayload, line: string): void {
    payload.totalLines += 1;
    if (this.maxTailLines === 0) return;
    if (payload.tail.length < this.maxTailLines) {
      payload.tail.push(line);
      return;
    }
    payload.tail[payload.tailStart] = line;
    payload.tailStart = (payload.tailStart + 1) % this.maxTailLines;
  }

  private snapshot(payload: TailPayload, pendingLine: string): IncrementalTranscriptTail {
    const lines =
      payload.tailStart === 0
        ? payload.tail.slice()
        : payload.tail.slice(payload.tailStart).concat(payload.tail.slice(0, payload.tailStart));
    const hasPendingLine = Boolean(pendingLine.trim());
    if (hasPendingLine && this.maxTailLines > 0) {
      lines.push(pendingLine);
      if (lines.length > this.maxTailLines) lines.shift();
    }
    return {
      totalLines: payload.totalLines + (hasPendingLine ? 1 : 0),
      lines,
    };
  }
}

const transcriptTailReader = new IncrementalTranscriptTailReader(500);

export function readIncrementalTranscriptTail(
  filePath: string
): Promise<IncrementalTranscriptTail> {
  return transcriptTailReader.read(filePath);
}
