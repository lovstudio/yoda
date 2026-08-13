import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/headless';
import type {
  PtyRenderCheckpoint,
  PtyRenderCheckpointDimensions,
} from '@shared/pty-render-checkpoint';

type CheckpointWrite = {
  data: string;
  sequence: number;
};

type SequenceMarker = {
  sequence: number;
};

type SnapshotRequest = {
  resolve: (snapshot: PtyRenderCheckpoint) => void;
  reject: (error: Error) => void;
};

type CheckpointQueueItem = CheckpointWrite | SequenceMarker | SnapshotRequest;

function isSnapshotRequest(item: CheckpointQueueItem): item is SnapshotRequest {
  return 'resolve' in item;
}

function isCheckpointWrite(item: CheckpointQueueItem): item is CheckpointWrite {
  return 'data' in item;
}

/**
 * Maintains only the current framebuffer for an evicted renderer. It starts
 * from xterm's compact serialized state and parses subsequent PTY output while
 * the visual renderer is absent, so reopening never needs the full ring buffer.
 */
export class PtyRenderCheckpointTracker {
  private readonly terminal: Terminal;
  private readonly serializeAddon = new SerializeAddon();
  private readonly queue: CheckpointQueueItem[] = [];
  private active = false;
  private disposed = false;
  private readonly generation: number;
  private sequence: number;

  constructor(checkpoint: PtyRenderCheckpoint) {
    this.generation = checkpoint.generation;
    this.sequence = checkpoint.sequence;
    this.terminal = new Terminal({
      cols: checkpoint.cols,
      rows: checkpoint.rows,
      scrollback: 0,
      convertEol: false,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializeAddon);
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = '11';
    this.write(checkpoint.buffer, checkpoint.sequence);
  }

  write(data: string, sequence: number): void {
    if (this.disposed || !data || sequence < this.sequence) return;
    this.queue.push({ data, sequence });
    this.pump();
  }

  markSequence(sequence: number): void {
    if (this.disposed || sequence <= this.sequence) return;
    this.queue.push({ sequence });
    this.pump();
  }

  snapshot(): Promise<PtyRenderCheckpoint> {
    if (this.disposed) return Promise.reject(new Error('PTY render checkpoint is disposed'));
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
    this.terminal.dispose();
  }

  private pump(): void {
    if (this.disposed || this.active) return;
    const item = this.queue.shift();
    if (!item) return;
    if (isSnapshotRequest(item)) {
      const dimensions: PtyRenderCheckpointDimensions = {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      };
      item.resolve({
        buffer: this.serializeAddon.serialize({ scrollback: 0 }),
        generation: this.generation,
        sequence: this.sequence,
        ...dimensions,
      });
      this.pump();
      return;
    }
    if (!isCheckpointWrite(item)) {
      this.sequence = Math.max(this.sequence, item.sequence);
      this.pump();
      return;
    }

    this.active = true;
    this.terminal.write(item.data, () => {
      if (this.disposed) return;
      this.sequence = Math.max(this.sequence, item.sequence);
      this.active = false;
      this.pump();
    });
  }
}
