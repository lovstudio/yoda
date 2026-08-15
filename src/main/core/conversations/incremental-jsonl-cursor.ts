import { open, type FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

export interface IncrementalJsonlSnapshot<TPayload> {
  payload: TPayload;
  /** Bytes after the last newline: a row the writer has not finished yet. */
  pendingLine: string;
}

export type IncrementalJsonlCursorOptions<TPayload> = {
  /** Builds the per-path accumulator. Called again whenever state is rebuilt. */
  createPayload: () => TPayload;
  /** Receives every complete, non-blank line exactly once, in file order. */
  commitLine: (payload: TPayload, line: string) => void;
  chunkBytes?: number;
  maxCacheEntries?: number;
  /** Read-work probe used by focused tests and runtime diagnostics. */
  onRead?: (filePath: string, position: number, length: number) => void;
};

type CursorState<TPayload> = {
  dev: number;
  ino: number;
  offset: number;
  decoder: StringDecoder;
  pendingLine: string;
  payload: TPayload;
};

/**
 * Byte-cursor scanner for append-only JSONL transcripts: each read consumes
 * only the bytes written since the previous one, so a live provider turn costs
 * the appended tail instead of the whole file. File replacement and truncation
 * rebuild the per-path accumulator.
 *
 * The accumulator itself is caller-owned — this class only guarantees that
 * every complete line reaches `commitLine` exactly once, in order.
 */
export class IncrementalJsonlCursor<TPayload> {
  private readonly createPayload: () => TPayload;
  private readonly commitLine: (payload: TPayload, line: string) => void;
  private readonly chunkBytes: number;
  private readonly maxCacheEntries: number;
  private readonly onRead: IncrementalJsonlCursorOptions<TPayload>['onRead'];
  private readonly states = new Map<string, CursorState<TPayload>>();
  private readonly reads = new Map<string, Promise<IncrementalJsonlSnapshot<TPayload>>>();

  constructor(options: IncrementalJsonlCursorOptions<TPayload>) {
    this.createPayload = options.createPayload;
    this.commitLine = options.commitLine;
    this.chunkBytes = Math.max(1, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK_BYTES));
    this.maxCacheEntries = Math.max(
      1,
      Math.floor(options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES)
    );
    this.onRead = options.onRead;
  }

  read(filePath: string): Promise<IncrementalJsonlSnapshot<TPayload>> {
    const active = this.reads.get(filePath);
    if (active) return active;

    const read = this.readIncrement(filePath)
      .catch((error) => {
        // A failed read may have advanced StringDecoder state. Rebuild next time
        // instead of reusing a potentially partial accumulator.
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

  private async readIncrement(filePath: string): Promise<IncrementalJsonlSnapshot<TPayload>> {
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
      return { payload: state.payload, pendingLine: state.pendingLine };
    } finally {
      await file.close();
    }
  }

  private async readThrough(
    filePath: string,
    file: FileHandle,
    state: CursorState<TPayload>,
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

  private createState(dev: number, ino: number): CursorState<TPayload> {
    return {
      dev,
      ino,
      offset: 0,
      decoder: new StringDecoder('utf8'),
      pendingLine: '',
      payload: this.createPayload(),
    };
  }

  private consumeDecodedText(state: CursorState<TPayload>, text: string): void {
    if (!text) return;
    let start = 0;
    let newline = text.indexOf('\n');
    while (newline !== -1) {
      const line = state.pendingLine + text.slice(start, newline);
      state.pendingLine = '';
      if (line.trim()) this.commitLine(state.payload, line);
      start = newline + 1;
      newline = text.indexOf('\n', start);
    }
    state.pendingLine += text.slice(start);
  }

  private takeState(filePath: string): CursorState<TPayload> | undefined {
    const state = this.states.get(filePath);
    if (!state) return undefined;
    // Map insertion order is the LRU order.
    this.states.delete(filePath);
    return state;
  }

  private storeState(filePath: string, state: CursorState<TPayload>): void {
    this.states.delete(filePath);
    this.states.set(filePath, state);
    while (this.states.size > this.maxCacheEntries) {
      const oldest = this.states.keys().next().value;
      if (oldest === undefined) break;
      this.states.delete(oldest);
    }
  }
}
