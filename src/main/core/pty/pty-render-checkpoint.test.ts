import { afterEach, describe, expect, it } from 'vitest';
import {
  PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES,
  PTY_CHECKPOINT_PARSER_LOW_WATERMARK_BYTES,
  PtyRenderCheckpointTracker,
} from './pty-render-checkpoint';

describe('PtyRenderCheckpointTracker', () => {
  let tracker: PtyRenderCheckpointTracker | null = null;

  afterEach(() => {
    tracker?.dispose();
    tracker = null;
  });

  it('returns an idle serialized checkpoint unchanged without allocating a headless parser', async () => {
    const buffer = '\x1bc\x1b[38;5;141mCANONICAL FRAME\x1b[0m';
    tracker = new PtyRenderCheckpointTracker({
      buffer,
      generation: 2,
      sequence: 6,
      cols: 100,
      rows: 30,
      canonical: true,
      scrollbackLines: 1_234,
    });

    await expect(tracker.snapshot()).resolves.toEqual({
      buffer,
      generation: 2,
      sequence: 6,
      cols: 100,
      rows: 30,
      canonical: true,
      scrollbackLines: 1_234,
    });
    expect(
      (tracker as unknown as { terminal: unknown }).terminal,
      'idle checkpoints should remain a bounded string instead of one xterm per task'
    ).toBeNull();
  });

  it('serializes the exact queued watermark without waiting for later output', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcCURRENT FRAME',
      generation: 7,
      sequence: 12,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 321,
    });

    const beforeLaterOutput = tracker.snapshot();
    tracker.write('\x1b[2J\x1b[HNEWEST FRAME', 13);

    const first = await beforeLaterOutput;
    expect(first).toMatchObject({
      generation: 7,
      sequence: 12,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 321,
    });
    expect(first.buffer).toContain('CURRENT FRAME');
    expect(first.buffer).not.toContain('NEWEST FRAME');

    const latest = await tracker.snapshot();
    expect(latest.sequence).toBe(13);
    expect(latest.canonical).toBe(false);
    expect(latest.scrollbackLines).toBe(321);
    expect(latest.buffer).toContain('NEWEST FRAME');
    expect(latest.buffer).not.toContain('CURRENT FRAME');
  });

  it('keeps recent scrollback while parsing output without a renderer', async () => {
    const history = Array.from(
      { length: 120 },
      (_, index) => `HISTORY-${index.toString().padStart(3, '0')}\r\n`
    ).join('');
    tracker = new PtyRenderCheckpointTracker({
      buffer: `\x1bc${history}CURRENT FRAME`,
      generation: 5,
      sequence: 8,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 128,
    });

    tracker.write('\r\nBACKGROUND OUTPUT', 9);
    const snapshot = await tracker.snapshot();

    expect(snapshot.sequence).toBe(9);
    expect(snapshot.buffer).toContain('HISTORY-000');
    expect(snapshot.buffer).toContain('HISTORY-119');
    expect(snapshot.buffer).toContain('BACKGROUND OUTPUT');
    expect(snapshot.canonical).toBe(false);
    expect(snapshot.scrollbackLines).toBe(128);
  });

  it('downgrades canonical provenance when the backend watermark advances', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcSTABLE FRAME',
      generation: 9,
      sequence: 20,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 456,
    });

    tracker.markSequence(21);
    const snapshot = await tracker.snapshot();

    expect(snapshot).toMatchObject({
      generation: 9,
      sequence: 21,
      canonical: false,
      scrollbackLines: 456,
    });
  });

  it('restores canonical provenance only after a complete synchronized frame parses', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcSTABLE FRAME',
      generation: 9,
      sequence: 20,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 456,
    });

    tracker.write('\x1b[?20', 21);
    tracker.write('26h\x1b[2J\x1b[H╭─ New frame ─╮\r\n│ Ready for input │', 22);
    expect((await tracker.snapshot()).canonical).toBe(false);

    tracker.write('\r\n╰─ Idle ─────────╯\x1b[?25', 23);
    tracker.write('h\x1b[?2026l', 24);
    const completed = await tracker.snapshot();

    expect(completed.sequence).toBe(24);
    expect(completed.canonical).toBe(true);
    expect(completed.buffer).toContain('New frame');
  });

  it('never trusts a synchronized repaint that remains open past a snapshot', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcSTABLE FRAME',
      generation: 4,
      sequence: 8,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 100,
    });

    tracker.write(
      '\x1b[?2026h\x1b[2J\x1b[HLoading workspace\r\nRestoring context\r\nPreparing terminal',
      9
    );

    await expect(tracker.snapshot()).resolves.toMatchObject({
      sequence: 9,
      canonical: false,
    });
  });

  it('orders a resize between the old-grid seed and a subsequent redraw', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: '\x1bcOLD GRID',
      generation: 11,
      sequence: 30,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 200,
    });

    tracker.resize(140, 42);
    tracker.write('\x1b[2J\x1b[HREDRAW AT NEW GRID', 31);
    const snapshot = await tracker.snapshot();

    expect(snapshot).toMatchObject({
      generation: 11,
      sequence: 31,
      cols: 140,
      rows: 42,
      canonical: false,
      scrollbackLines: 200,
    });
    expect(snapshot.buffer).toContain('REDRAW AT NEW GRID');
    expect(snapshot.buffer).not.toContain('OLD GRID');
  });

  it('accounts for seed and queued VT bytes and releases parser backpressure after drain', async () => {
    const pressureChanges: Array<{ backpressured: boolean; pendingBytes: number }> = [];
    const seed = 'S'.repeat(PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES);
    tracker = new PtyRenderCheckpointTracker(
      {
        buffer: seed,
        generation: 10,
        sequence: 1,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      },
      {
        onBackpressureChange: (backpressured, pendingBytes) => {
          pressureChanges.push({ backpressured, pendingBytes });
        },
      }
    );

    // An idle seed remains an O(1) string until new output requires parsing.
    expect(tracker.pendingBytes).toBe(0);
    tracker.write('NEW OUTPUT', 2);
    expect(pressureChanges[0]).toMatchObject({ backpressured: true });
    expect(pressureChanges[0]?.pendingBytes).toBeGreaterThanOrEqual(
      PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES
    );

    const snapshot = await tracker.snapshot();

    expect(snapshot.sequence).toBe(2);
    expect(tracker.pendingBytes).toBe(0);
    expect(pressureChanges.at(-1)).toMatchObject({ backpressured: false });
    expect(pressureChanges.at(-1)?.pendingBytes).toBeLessThanOrEqual(
      PTY_CHECKPOINT_PARSER_LOW_WATERMARK_BYTES
    );
    expect(
      pressureChanges.some(
        ({ backpressured, pendingBytes }) =>
          !backpressured && pendingBytes <= PTY_CHECKPOINT_PARSER_LOW_WATERMARK_BYTES
      )
    ).toBe(true);
  });

  it('rejects a queued snapshot when the tracker is disposed', async () => {
    tracker = new PtyRenderCheckpointTracker({
      buffer: `${'busy output'.repeat(10_000)}CURRENT FRAME`,
      generation: 3,
      sequence: 4,
      cols: 80,
      rows: 24,
      canonical: true,
      scrollbackLines: 100,
    });

    tracker.write('LATER OUTPUT', 5);
    const snapshot = tracker.snapshot();
    tracker.dispose();

    await expect(snapshot).rejects.toThrow('disposed');
  });
});
