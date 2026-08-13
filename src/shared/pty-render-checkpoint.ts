/** Compact terminal framebuffer captured immediately before a renderer cache eviction. */
export type PtyRenderCheckpoint = {
  buffer: string;
  generation: number;
  sequence: number;
  cols: number;
  rows: number;
};

export type PtyRenderCheckpointDimensions = Pick<PtyRenderCheckpoint, 'cols' | 'rows'>;
