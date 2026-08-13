import { Buffer } from 'node:buffer';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import headlessXterm, { type Terminal as HeadlessTerminal } from '@xterm/headless';
import {
  PTY_RENDER_CHECKPOINT_MAX_BYTES,
  type PtyRenderCheckpoint,
  type PtyRenderCheckpointDimensions,
} from '@shared/pty-render-checkpoint';

// @xterm/headless publishes its Node entrypoint as CommonJS. electron-vite
// externalizes dependencies in the main bundle, so a named ESM import fails
// when Electron loads the bundle even though bundler-based tests accept it.
const { Terminal } = headlessXterm;

type CheckpointWrite = {
  data: string;
  sequence: number;
  byteLength: number;
  canonicalAfterParse: boolean;
};

type SequenceMarker = {
  sequence: number;
};

type CheckpointResize = {
  cols: number;
  rows: number;
};

type SnapshotRequest = {
  resolve: (snapshot: PtyRenderCheckpoint) => void;
  reject: (error: Error) => void;
};

type CheckpointQueueItem = CheckpointWrite | SequenceMarker | CheckpointResize | SnapshotRequest;

export const PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES = 384 * 1024;
export const PTY_CHECKPOINT_PARSER_LOW_WATERMARK_BYTES = 96 * 1024;

const SYNCHRONIZED_OUTPUT_START = '\x1b[?2026h';
const SYNCHRONIZED_OUTPUT_END = '\x1b[?2026l';
const SYNCHRONIZED_OUTPUT_CURSOR_SHOW = '\x1b[?25h';
const SYNCHRONIZED_OUTPUT_SCAN_OVERLAP =
  Math.max(
    SYNCHRONIZED_OUTPUT_START.length,
    SYNCHRONIZED_OUTPUT_END.length,
    SYNCHRONIZED_OUTPUT_CURSOR_SHOW.length
  ) - 1;

type PtyRenderCheckpointTrackerOptions = {
  onBackpressureChange?: (backpressured: boolean, pendingBytes: number) => void;
};

function isSnapshotRequest(item: CheckpointQueueItem): item is SnapshotRequest {
  return 'resolve' in item;
}

function isCheckpointWrite(item: CheckpointQueueItem): item is CheckpointWrite {
  return 'data' in item;
}

function isCheckpointResize(item: CheckpointQueueItem): item is CheckpointResize {
  return 'cols' in item;
}

function serializeBoundedTerminal(
  terminal: HeadlessTerminal,
  serializeAddon: SerializeAddon,
  scrollbackLines: number
): string {
  let scrollback = Math.min(scrollbackLines, terminal.buffer.active.baseY);
  let buffer = serializeAddon.serialize({ scrollback });
  let byteLength = Buffer.byteLength(buffer, 'utf8');
  while (byteLength > PTY_RENDER_CHECKPOINT_MAX_BYTES && scrollback > 0) {
    scrollback = Math.max(
      0,
      Math.min(
        scrollback - 1,
        Math.floor((scrollback * PTY_RENDER_CHECKPOINT_MAX_BYTES) / byteLength)
      )
    );
    buffer = serializeAddon.serialize({ scrollback });
    byteLength = Buffer.byteLength(buffer, 'utf8');
  }
  return buffer;
}

/**
 * Maintains bounded serialized terminal state for an evicted renderer. It
 * starts from xterm's checkpoint and parses subsequent PTY output while the
 * visual renderer is absent, preserving recent scrollback and terminal modes
 * without retaining the visual xterm or replaying an arbitrary raw byte tail.
 */
export class PtyRenderCheckpointTracker {
  private terminal: HeadlessTerminal | null = null;
  private serializeAddon: SerializeAddon | null = null;
  private seedCheckpoint: PtyRenderCheckpoint | null;
  private readonly queue: CheckpointQueueItem[] = [];
  private active = false;
  private disposed = false;
  private parserPendingBytes = 0;
  private parserBackpressured = false;
  private readonly generation: number;
  private canonical: boolean;
  private scannedCanonical: boolean;
  private synchronizedOutputOpen = false;
  private synchronizedOutputCursorShown = false;
  private synchronizedOutputScanTail = '';
  private readonly scrollbackLines: number;
  private sequence: number;

  constructor(
    checkpoint: PtyRenderCheckpoint,
    private readonly options: PtyRenderCheckpointTrackerOptions = {}
  ) {
    this.generation = checkpoint.generation;
    this.canonical = checkpoint.canonical;
    this.scannedCanonical = checkpoint.canonical;
    this.scrollbackLines = checkpoint.scrollbackLines;
    this.sequence = checkpoint.sequence;
    // Most evicted sessions are idle. Keep their already-canonical serialized
    // state as-is so reopening can return it without parsing and serializing it
    // once in main before the renderer parses it again. A headless terminal is
    // created lazily only if output arrives while the renderer is absent.
    this.seedCheckpoint = { ...checkpoint };
  }

  write(data: string, sequence: number, knownByteLength?: number): void {
    if (this.disposed || !data || sequence < this.sequence) return;
    // Raw PTY output starts untrusted, then becomes canonical again only after
    // a complete DEC synchronized-output transaction (including cursor-show)
    // has crossed the headless parser callback. Scan ingress order here and
    // attach that resulting provenance to the queued parser job so later
    // partial writes cannot accidentally inherit an earlier completed frame.
    const canonicalAfterParse = this.scanCanonicalPayload(data);
    this.canonical = false;
    const byteLength = knownByteLength ?? Buffer.byteLength(data, 'utf8');
    this.adjustParserPendingBytes(byteLength);
    this.queue.push({ data, sequence, byteLength, canonicalAfterParse });
    this.pump();
  }

  get pendingBytes(): number {
    return this.parserPendingBytes;
  }

  markSequence(sequence: number): void {
    if (this.disposed || sequence <= this.sequence) return;
    this.canonical = false;
    this.scannedCanonical = false;
    this.queue.push({ sequence });
    this.pump();
  }

  /** Apply a backend grid change in the same order as surrounding PTY output. */
  resize(cols: number, rows: number): void {
    if (
      this.disposed ||
      !Number.isSafeInteger(cols) ||
      cols < 2 ||
      !Number.isSafeInteger(rows) ||
      rows < 1
    ) {
      return;
    }
    this.canonical = false;
    this.scannedCanonical = false;
    this.queue.push({ cols, rows });
    this.pump();
  }

  snapshot(): Promise<PtyRenderCheckpoint> {
    if (this.disposed) return Promise.reject(new Error('PTY render checkpoint is disposed'));
    if (!this.terminal && !this.active && this.queue.length === 0 && this.seedCheckpoint) {
      return Promise.resolve({ ...this.seedCheckpoint });
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error('PTY render checkpoint is disposed');
    for (const item of this.queue) {
      if (isSnapshotRequest(item)) item.reject(error);
    }
    this.queue.length = 0;
    this.seedCheckpoint = null;
    this.parserPendingBytes = 0;
    this.updateBackpressure();
    this.terminal?.dispose();
    this.terminal = null;
    this.serializeAddon = null;
  }

  private pump(): void {
    if (this.disposed || this.active) return;
    if (this.queue.length === 0) return;
    if (!this.terminal || !this.serializeAddon) {
      this.initializeTerminal();
      return;
    }
    const item = this.queue.shift();
    if (!item) return;
    if (isSnapshotRequest(item)) {
      const dimensions: PtyRenderCheckpointDimensions = {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      };
      item.resolve({
        buffer: serializeBoundedTerminal(this.terminal, this.serializeAddon, this.scrollbackLines),
        generation: this.generation,
        sequence: this.sequence,
        canonical: this.canonical,
        scrollbackLines: this.scrollbackLines,
        ...dimensions,
      });
      this.pump();
      return;
    }
    if (!isCheckpointWrite(item)) {
      if (isCheckpointResize(item)) {
        this.terminal.resize(item.cols, item.rows);
        this.pump();
        return;
      }
      this.sequence = Math.max(this.sequence, item.sequence);
      this.pump();
      return;
    }

    this.active = true;
    this.terminal.write(item.data, () => {
      if (this.disposed) return;
      this.sequence = Math.max(this.sequence, item.sequence);
      this.canonical = item.canonicalAfterParse;
      this.adjustParserPendingBytes(-item.byteLength);
      this.active = false;
      this.pump();
    });
  }

  private initializeTerminal(): void {
    const checkpoint = this.seedCheckpoint;
    if (!checkpoint || this.terminal || this.serializeAddon) return;

    const terminal = new Terminal({
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      scrollback: checkpoint.scrollbackLines,
      convertEol: false,
      allowProposedApi: true,
    });
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    this.terminal = terminal;
    this.serializeAddon = serializeAddon;
    this.active = true;
    const seedByteLength = Buffer.byteLength(checkpoint.buffer, 'utf8');
    this.adjustParserPendingBytes(seedByteLength);

    const finish = () => {
      if (this.disposed) return;
      this.adjustParserPendingBytes(-seedByteLength);
      this.seedCheckpoint = null;
      this.active = false;
      this.pump();
    };
    if (checkpoint.buffer) {
      terminal.write(checkpoint.buffer, finish);
    } else {
      finish();
    }
  }

  private adjustParserPendingBytes(delta: number): void {
    this.parserPendingBytes = Math.max(0, this.parserPendingBytes + delta);
    this.updateBackpressure();
  }

  /** Track DEC synchronized-output markers across arbitrary PTY chunk boundaries. */
  private scanCanonicalPayload(data: string): boolean {
    this.scannedCanonical = false;
    const scan = this.synchronizedOutputScanTail + data;
    let offset = 0;
    while (offset < scan.length) {
      const startIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_START, offset);
      const endIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_END, offset);
      const cursorIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_CURSOR_SHOW, offset);
      const nextIndex = Math.min(
        startIndex < 0 ? Number.POSITIVE_INFINITY : startIndex,
        endIndex < 0 ? Number.POSITIVE_INFINITY : endIndex,
        cursorIndex < 0 ? Number.POSITIVE_INFINITY : cursorIndex
      );
      if (!Number.isFinite(nextIndex)) break;
      if (nextIndex === startIndex) {
        this.synchronizedOutputOpen = true;
        this.synchronizedOutputCursorShown = false;
        this.scannedCanonical = false;
        offset = startIndex + SYNCHRONIZED_OUTPUT_START.length;
        continue;
      }
      if (nextIndex === cursorIndex) {
        if (this.synchronizedOutputOpen) this.synchronizedOutputCursorShown = true;
        offset = cursorIndex + SYNCHRONIZED_OUTPUT_CURSOR_SHOW.length;
        continue;
      }
      if (nextIndex === endIndex && this.synchronizedOutputOpen) {
        this.scannedCanonical = this.synchronizedOutputCursorShown;
        this.synchronizedOutputOpen = false;
        this.synchronizedOutputCursorShown = false;
      }
      offset = endIndex + SYNCHRONIZED_OUTPUT_END.length;
    }
    this.synchronizedOutputScanTail = scan.slice(-SYNCHRONIZED_OUTPUT_SCAN_OVERLAP);
    return this.scannedCanonical && !this.synchronizedOutputOpen;
  }

  private updateBackpressure(): void {
    const nextBackpressured = this.parserBackpressured
      ? this.parserPendingBytes > PTY_CHECKPOINT_PARSER_LOW_WATERMARK_BYTES
      : this.parserPendingBytes >= PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES;
    if (nextBackpressured === this.parserBackpressured) return;
    this.parserBackpressured = nextBackpressured;
    this.options.onBackpressureChange?.(nextBackpressured, this.parserPendingBytes);
  }
}
