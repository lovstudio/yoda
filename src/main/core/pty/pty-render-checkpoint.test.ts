import { afterEach, describe, expect, it } from 'vitest';
import { PtyRenderCheckpointTracker } from './pty-render-checkpoint';

describe('PtyRenderCheckpointTracker', () => {
  let tracker: PtyRenderCheckpointTracker | null = null;

  afterEach(() => {
    tracker?.dispose();
    tracker = null;
  });

  it('serializes the exact queued watermark without waiting for later output', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcCURRENT FRAME',
      generation: 7,
      sequence: 12,
      cols: 80,
      rows: 24,
    });

    const beforeLaterOutput = tracker.snapshot();
    tracker.write('\x1b[2J\x1b[HNEWEST FRAME', 13);

    const first = await beforeLaterOutput;
    expect(first).toMatchObject({ generation: 7, sequence: 12, cols: 80, rows: 24 });
    expect(first.buffer).toContain('CURRENT FRAME');
    expect(first.buffer).not.toContain('NEWEST FRAME');

    const latest = await tracker.snapshot();
    expect(latest.sequence).toBe(13);
    expect(latest.buffer).toContain('NEWEST FRAME');
    expect(latest.buffer).not.toContain('CURRENT FRAME');
  });

  it('rejects a queued snapshot when the tracker is disposed', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: `${'busy output'.repeat(10_000)}CURRENT FRAME`,
      generation: 3,
      sequence: 4,
      cols: 80,
      rows: 24,
    });

    const snapshot = tracker.snapshot();
    tracker.dispose();

    await expect(snapshot).rejects.toThrow('disposed');
  });
});
