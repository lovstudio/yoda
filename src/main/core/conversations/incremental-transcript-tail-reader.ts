import { open, type FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

export interface IncrementalTranscriptTail {
  totalLines: number;
  lines: string[];
}

type ReaderState = {
  dev: number;
  ino: number;
  offset: number;
  decoder: StringDecoder;
  pendingLine: string;
  committedTotalLines: number;
  committedTail: string[];
  committedTailStart: number;
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
  private readonly chunkBytes: number;
  private readonly maxCacheEntries: number;
  private readonly onRead: ReaderOptions['onRead'];
  private readonly states = new Map<string, ReaderState>();
  private readonly reads = new Map<string, Promise<IncrementalTranscriptTail>>();

  constructor(maxTailLines: number, options: ReaderOptions = {}) {
    this.maxTailLines = Math.max(0, Math.floor(maxTailLines));
    this.chunkBytes = Math.max(1, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK_BYTES));
    this.maxCacheEntries = Math.max(
      1,
      Math.floor(options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES)
    );
    this.onRead = options.onRead;
  }

  read(filePath: string): Promise<IncrementalTranscriptTail> {
    const active = this.reads.get(filePath);
    if (active) return active;

    const read = this.readIncrement(filePath)
      .catch((error) => {
        // A failed read may have advanced StringDecoder state. Rebuild next time
        // instead of reusing a potentially partial snapshot.
        this.states.delete(filePath);
        throw error;
      })
      .finally(() => {
        if (this.reads.get(filePath) === read) this.reads.delete(filePath);
      });
    this.reads.set(filePath, read);
    return read;
  }

  clear(filePath?: string): void {
    if (filePath === undefined) this.states.clear();
    else this.states.delete(filePath);
  }

  private async readIncrement(filePath: string): Promise<IncrementalTranscriptTail> {
    const file = await open(filePath, 'r');
    try {
      const metadata = await file.stat();
      const cached = this.takeState(filePath);
      const mustRebuild =
        !cached ||
        cached.dev !== metadata.dev ||
        cached.ino !== metadata.ino ||
        metadata.size < cached.offset;
      let state = mustRebuild ? this.createState(metadata.dev, metadata.ino) : cached;
      await this.readThrough(filePath, file, state, metadata.size);

      // A change event can race with this read and join its single-flight. Take
      // one bounded catch-up snapshot so an append during the first pass is not
      // stranded until an unrelated later event. Do not chase a hot writer.
      const catchUpMetadata = await file.stat();
      if (catchUpMetadata.size < state.offset) {
        state = this.createState(catchUpMetadata.dev, catchUpMetadata.ino);
        await this.readThrough(filePath, file, state, catchUpMetadata.size);
      } else if (catchUpMetadata.size > state.offset) {
        await this.readThrough(filePath, file, state, catchUpMetadata.size);
      }

      this.storeState(filePath, state);
      return this.snapshot(state);
    } finally {
      await file.close();
    }
  }

  private async readThrough(
    filePath: string,
    file: FileHandle,
    state: ReaderState,
    targetSize: number
  ): Promise<void> {
    while (state.offset < targetSize) {
      const length = Math.min(this.chunkBytes, targetSize - state.offset);
      const position = state.offset;
      const buffer = Buffer.allocUnsafe(length);
      this.onRead?.(filePath, position, length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      if (bytesRead === 0) break;
      state.offset += bytesRead;
      this.consumeDecodedText(state, state.decoder.write(buffer.subarray(0, bytesRead)));
    }
  }

  private createState(dev: number, ino: number): ReaderState {
    return {
      dev,
      ino,
      offset: 0,
      decoder: new StringDecoder('utf8'),
      pendingLine: '',
      committedTotalLines: 0,
      committedTail: [],
      committedTailStart: 0,
    };
  }

  private consumeDecodedText(state: ReaderState, text: string): void {
    if (!text) return;
    let start = 0;
    let newline = text.indexOf('\n');
    while (newline !== -1) {
      const line = state.pendingLine + text.slice(start, newline);
      state.pendingLine = '';
      this.commitLine(state, line);
      start = newline + 1;
      newline = text.indexOf('\n', start);
    }
    state.pendingLine += text.slice(start);
  }

  private commitLine(state: ReaderState, line: string): void {
    if (!line.trim()) return;
    state.committedTotalLines += 1;
    if (this.maxTailLines === 0) return;
    if (state.committedTail.length < this.maxTailLines) {
      state.committedTail.push(line);
      return;
    }
    state.committedTail[state.committedTailStart] = line;
    state.committedTailStart = (state.committedTailStart + 1) % this.maxTailLines;
  }

  private snapshot(state: ReaderState): IncrementalTranscriptTail {
    const lines =
      state.committedTailStart === 0
        ? state.committedTail.slice()
        : state.committedTail
            .slice(state.committedTailStart)
            .concat(state.committedTail.slice(0, state.committedTailStart));
    const hasPendingLine = Boolean(state.pendingLine.trim());
    if (hasPendingLine && this.maxTailLines > 0) {
      lines.push(state.pendingLine);
      if (lines.length > this.maxTailLines) lines.shift();
    }
    return {
      totalLines: state.committedTotalLines + (hasPendingLine ? 1 : 0),
      lines,
    };
  }

  private takeState(filePath: string): ReaderState | undefined {
    const state = this.states.get(filePath);
    if (!state) return undefined;
    // Map insertion order is the LRU order.
    this.states.delete(filePath);
    return state;
  }

  private storeState(filePath: string, state: ReaderState): void {
    this.states.delete(filePath);
    this.states.set(filePath, state);
    while (this.states.size > this.maxCacheEntries) {
      const oldest = this.states.keys().next().value;
      if (oldest === undefined) break;
      this.states.delete(oldest);
    }
  }
}

const transcriptTailReader = new IncrementalTranscriptTailReader(500);

export function readIncrementalTranscriptTail(
  filePath: string
): Promise<IncrementalTranscriptTail> {
  return transcriptTailReader.read(filePath);
}
