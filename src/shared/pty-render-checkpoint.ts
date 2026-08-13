/**
 * Bounded serialized terminal state captured immediately before a renderer
 * cache eviction. It contains the current screen, terminal modes, and a recent
 * scrollback window so a reconstructed xterm does not fall back to an
 * arbitrary raw VT byte tail.
 */
export type PtyRenderCheckpoint = {
  buffer: string;
  generation: number;
  sequence: number;
  cols: number;
  rows: number;
  /** True only when the buffer was captured from a fully parsed, stable renderer frame. */
  canonical: boolean;
  /** Actual bounded scrollback capacity represented by this checkpoint. */
  scrollbackLines: number;
};

export type PtyRenderCheckpointDimensions = Pick<PtyRenderCheckpoint, 'cols' | 'rows'>;

/** Maximum checkpoint context; each checkpoint still carries its actual smaller capacity. */
export const PTY_RENDER_CHECKPOINT_SCROLLBACK_LINES = 5_000;
/** Keep checkpoint IPC and each headless replacement parser predictably bounded. */
export const PTY_RENDER_CHECKPOINT_MAX_BYTES = 1024 * 1024;
