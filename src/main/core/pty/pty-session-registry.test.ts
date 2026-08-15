import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { getTerminalRingBufferCapBytes } from '@shared/terminal-settings';
import type { Pty, PtyExitInfo } from './pty';
import { PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES } from './pty-render-checkpoint';
import {
  PTY_CONSUMER_LEASE_TIMEOUT_MS,
  PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES,
  PTY_GENERATION_REVEAL_CLAIM_TIMEOUT_MS,
  PTY_OUTPUT_BATCH_MAX_BYTES,
  PTY_PENDING_INPUT_MAX_CHUNKS,
  PTY_PENDING_INPUT_MAX_SESSIONS,
  PTY_RENDERER_DETACH_GRACE_MS,
  PtySessionRegistry,
} from './pty-session-registry';

const eventMocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  return {
    emit: vi.fn(),
    listeners,
    on: vi.fn((event: { name: string }, listener: (data: unknown) => void, topic?: string) => {
      const key = `${event.name}.${topic ?? ''}`;
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    }),
  };
});

vi.mock('@main/lib/events', () => ({
  events: {
    emit: eventMocks.emit,
    on: eventMocks.on,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

class FakePty implements Pty {
  readonly writes: string[] = [];
  readonly pause = vi.fn();
  readonly resume = vi.fn();
  readonly kill = vi.fn();
  readonly resize = vi.fn<(cols: number, rows: number) => void | boolean>();
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((info: PtyExitInfo) => void) | null = null;

  write(data: string): void {
    this.writes.push(data);
  }

  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandler = handler;
  }

  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    this.exitHandler?.(info);
  }
}

function emitInput(sessionId: string, data: string): void {
  const key = `${ptyInputChannel.name}.${sessionId}`;
  for (const listener of eventMocks.listeners.get(key) ?? []) {
    listener(data);
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

beforeEach(() => {
  vi.useFakeTimers();
  eventMocks.emit.mockClear();
  eventMocks.on.mockClear();
  eventMocks.listeners.clear();
});

describe('PtySessionRegistry', () => {
  it('restores an evicted renderer from a compact current-frame checkpoint', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const oldHistory = `${'old terminal history\r\n'.repeat(20_000)}CURRENT FRAME`;
    registry.register('session', pty);
    pty.emitData(oldHistory);

    expect(registry.subscribe('session', 'old-renderer')).toMatchObject({
      generation: 1,
      sequence: 0,
    });
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcCURRENT FRAME',
        generation: 1,
        sequence: 0,
        cols: 120,
        rows: 32,
        canonical: true,
        scrollbackLines: 1_234,
      })
    ).toBe(true);
    registry.unsubscribe('session', 'old-renderer');
    const sessionState = (
      registry as unknown as {
        sessions: Map<string, { ringBuffer: { snapshot(): string } }>;
      }
    ).sessions.get('session');
    expect(sessionState).toBeDefined();
    if (!sessionState) throw new Error('Expected registered PTY state');
    const ringSnapshot = vi.spyOn(sessionState.ringBuffer, 'snapshot');

    pty.emitData('\x1b[2J\x1b[HNEWEST FRAME');
    const compact = await registry.subscribeForRenderer('session', 'new-renderer');

    expect(compact).toMatchObject({
      generation: 1,
      sequence: 0,
      checkpointCanonical: false,
      checkpointDimensions: { cols: 120, rows: 32 },
    });
    expect(compact.buffer).toContain('NEWEST FRAME');
    expect(compact.buffer).not.toContain('old terminal history');
    expect(Buffer.byteLength(compact.buffer, 'utf8')).toBeLessThan(4 * 1024);
    expect(ringSnapshot).not.toHaveBeenCalled();
    expect(Buffer.byteLength(registry.snapshot('session'), 'utf8')).toBeGreaterThan(300_000);

    registry.unsubscribe('session', 'new-renderer');
  });

  it('passes through trusted idle checkpoint provenance and its actual scrollback capacity', async () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    pty.emitData('raw history that must not replace the canonical frame');
    registry.subscribe('session', 'old-renderer');

    const checkpoint = {
      buffer: '\x1bcTRUSTED FRAME',
      generation: 1,
      sequence: 0,
      cols: 100,
      rows: 30,
      canonical: true,
      scrollbackLines: 777,
    } as const;
    expect(registry.saveRenderCheckpoint('session', checkpoint)).toBe(true);
    registry.unsubscribe('session', 'old-renderer');

    await expect(registry.subscribeForRenderer('session', 'new-renderer')).resolves.toEqual({
      buffer: checkpoint.buffer,
      generation: 1,
      sequence: 0,
      checkpointCanonical: true,
      checkpointDimensions: { cols: 100, rows: 30 },
    });
    registry.unsubscribe('session', 'new-renderer');
  });

  it('retains an exact non-canonical checkpoint for recovery without granting fast reveal', async () => {
    const registry = new PtySessionRegistry();
    registry.register('session', new FakePty());

    const checkpoint = {
      buffer: '\x1bcUNTRUSTED FRAME',
      generation: 1,
      sequence: 0,
      cols: 80,
      rows: 24,
      canonical: false,
      scrollbackLines: 500,
    } as const;
    expect(registry.saveRenderCheckpoint('session', checkpoint)).toBe(true);

    await expect(registry.subscribeForRenderer('session', 'new-renderer')).resolves.toEqual({
      buffer: checkpoint.buffer,
      generation: 1,
      sequence: 0,
      checkpointCanonical: false,
      checkpointDimensions: { cols: 80, rows: 24 },
    });
    registry.unsubscribe('session', 'new-renderer');
  });

  it('atomically resizes the expected live generation and its compact checkpoint', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty, { initialDimensions: { cols: 80, rows: 24 } });
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcOLD GRID',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);

    expect(registry.resizeForRenderer('session', 1, 140, 42)).toEqual({
      generation: 1,
      changed: true,
    });
    expect(pty.resize).toHaveBeenCalledWith(140, 42);
    expect(registry.resizeForRenderer('session', 1, 140, 42)).toEqual({
      generation: 1,
      changed: false,
    });
    expect(pty.resize).toHaveBeenCalledOnce();

    await expect(registry.subscribeForRenderer('session', 'renderer')).resolves.toMatchObject({
      generation: 1,
      sequence: 0,
      checkpointCanonical: false,
      checkpointDimensions: { cols: 140, rows: 42 },
    });
    registry.unsubscribe('session', 'renderer');
  });

  it('skips an exact same-grid backend resize and preserves the canonical checkpoint seed', async () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty, { initialDimensions: { cols: 128, rows: 43 } });
    const checkpoint = {
      buffer: '\x1bcCANONICAL SAME GRID',
      generation: 1,
      sequence: 0,
      cols: 128,
      rows: 43,
      canonical: true,
      scrollbackLines: 500,
    } as const;
    expect(registry.saveRenderCheckpoint('session', checkpoint)).toBe(true);

    expect(registry.resizeForRenderer('session', 1, 128, 43)).toEqual({
      generation: 1,
      changed: false,
    });
    expect(pty.resize).not.toHaveBeenCalled();

    await expect(registry.subscribeForRenderer('session', 'renderer')).resolves.toEqual({
      buffer: checkpoint.buffer,
      generation: 1,
      sequence: 0,
      checkpointCanonical: true,
      checkpointDimensions: { cols: 128, rows: 43 },
    });
    registry.unsubscribe('session', 'renderer');
  });

  it('resizes the current live generation and its checkpoint during replacement registration', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcCURRENT GRID',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);

    const replacementEpoch = registry.beginRegistration('session');
    expect(registry.resizeCurrent('session', 132, 41)).toEqual({
      generation: 1,
      changed: true,
    });
    expect(pty.resize).toHaveBeenCalledWith(132, 41);
    registry.cancelRegistration('session', replacementEpoch);

    await expect(registry.subscribeForRenderer('session', 'renderer')).resolves.toMatchObject({
      generation: 1,
      checkpointCanonical: false,
      checkpointDimensions: { cols: 132, rows: 41 },
    });
    registry.unsubscribe('session', 'renderer');
  });

  it('rejects stale or failed renderer resizes without changing checkpoint dimensions', async () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcSTABLE GRID',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);

    expect(registry.resizeForRenderer('session', 0, 120, 30)).toBeNull();
    expect(pty.resize).not.toHaveBeenCalled();
    expect(registry.resizeForRenderer('session', 1, 1, 30)).toBeNull();
    expect(pty.resize).not.toHaveBeenCalled();
    pty.resize.mockReturnValue(false);
    expect(registry.resizeForRenderer('session', 1, 120, 30)).toBeNull();

    await expect(registry.subscribeForRenderer('session', 'renderer')).resolves.toMatchObject({
      checkpointCanonical: true,
      checkpointDimensions: { cols: 80, rows: 24 },
    });
    registry.unsubscribe('session', 'renderer');
  });

  it('does not commit a failed backend grid and retries the same target', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty, { initialDimensions: { cols: 80, rows: 24 } });
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcSTABLE GRID',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 500,
      })
    ).toBe(true);

    pty.resize.mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(registry.resizeForRenderer('session', 1, 120, 30)).toBeNull();
    expect(registry.resizeForRenderer('session', 1, 120, 30)).toEqual({
      generation: 1,
      changed: true,
    });
    expect(pty.resize).toHaveBeenCalledTimes(2);
    expect(pty.resize).toHaveBeenNthCalledWith(1, 120, 30);
    expect(pty.resize).toHaveBeenNthCalledWith(2, 120, 30);

    await expect(registry.subscribeForRenderer('session', 'renderer')).resolves.toMatchObject({
      checkpointCanonical: false,
      checkpointDimensions: { cols: 120, rows: 30 },
    });
    registry.unsubscribe('session', 'renderer');
  });

  it('rejects the old live generation while its replacement is registering', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.beginRegistration('session');

    expect(registry.resizeForRenderer('session', 1, 120, 30)).toBeNull();
    expect(pty.resize).not.toHaveBeenCalled();
  });

  it('pauses a hidden producer for checkpoint parser backlog without replaying pending bytes twice', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'old-renderer');
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcBASE FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);
    registry.unsubscribe('session', 'old-renderer');
    eventMocks.emit.mockClear();

    pty.emitData('H'.repeat(PTY_CHECKPOINT_PARSER_HIGH_WATERMARK_BYTES));

    expect(pty.pause).toHaveBeenCalledTimes(1);
    expect(registry.getDiagnostics('session')?.pendingOutputBytes).toBe(0);

    const snapshot = await registry.subscribeForRenderer('session', 'new-renderer');

    expect(snapshot.checkpointCanonical).toBe(false);
    expect(pty.resume).toHaveBeenCalledTimes(1);
    expect(
      eventMocks.emit.mock.calls.filter(([event]) => event === ptyDataChannel),
      'bytes returned by the checkpoint must not be emitted again after resume'
    ).toEqual([]);
    registry.unsubscribe('session', 'new-renderer');
  });

  it('does not let renderer ACK release checkpoint parser backpressure', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'old-renderer');
    pty.emitData('R'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    expect(pty.pause).toHaveBeenCalledTimes(1);

    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcBASE FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);
    registry.unsubscribe('session', 'old-renderer');

    // Unsubscribe prunes the renderer inflight window, but the independent
    // checkpoint parser reason must keep the transport paused.
    expect(pty.resume).not.toHaveBeenCalled();

    await registry.subscribeForRenderer('session', 'new-renderer');
    expect(pty.resume).toHaveBeenCalledTimes(1);
    registry.unsubscribe('session', 'new-renderer');
  });

  it('does not include a paused multi-consumer tail in both checkpoint and live output', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const sequenceAtPause = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;
    const pendingTail = '\r\nDUPLICATE-MARKER\r\n';
    registry.register('session', pty);
    registry.subscribe('session', 'consumer-a');
    registry.subscribe('session', 'consumer-b');

    pty.emitData('X'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    pty.emitData(pendingTail);
    expect(pty.pause).toHaveBeenCalledTimes(1);
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcFRAME THROUGH SEQUENCE SIX',
        generation: 1,
        sequence: sequenceAtPause,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);
    registry.unsubscribe('session', 'consumer-a');
    eventMocks.emit.mockClear();

    const snapshot = await registry.subscribeForRenderer('session', 'consumer-c');

    expect(snapshot).toMatchObject({
      generation: 1,
      sequence: sequenceAtPause,
      checkpointDimensions: { cols: 80, rows: 24 },
    });
    expect(snapshot.buffer).not.toContain('DUPLICATE-MARKER');

    registry.acknowledge('session', 'consumer-c', 1, sequenceAtPause);
    registry.acknowledge('session', 'consumer-b', 1, sequenceAtPause);
    await vi.waitFor(() => {
      const liveTail = eventMocks.emit.mock.calls
        .filter(([event]) => event === ptyDataChannel)
        .map(([, payload]) => (payload as { data: string }).data)
        .join('');
      expect(liveTail).toBe(pendingTail);
    });

    registry.unsubscribe('session', 'consumer-b');
    registry.unsubscribe('session', 'consumer-c');
  });

  it('atomically transfers pending output when the final checkpoint consumer leaves', async () => {
    vi.useRealTimers();
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const pendingTail = '\r\nFINAL-COLD-MARKER\r\n';
    registry.register('session', pty);
    registry.subscribe('session', 'old-renderer');
    pty.emitData('Y'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    pty.emitData(pendingTail);
    eventMocks.emit.mockClear();

    expect(
      registry.checkpointAndUnsubscribe('session', 'old-renderer', {
        buffer: '\x1bcBASE FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);
    expect(registry.getDiagnostics('session')?.pendingOutputBytes).toBe(0);

    const snapshot = await registry.subscribeForRenderer('session', 'new-renderer');

    expect(snapshot.sequence).toBe(
      PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES
    );
    expect(snapshot.buffer).toContain('FINAL-COLD-MARKER');
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyDataChannel)).toEqual([]);
    expect(pty.resume).toHaveBeenCalledTimes(1);
    registry.unsubscribe('session', 'new-renderer');
  });

  it('notifies a tmux-backed session after its final checkpoint consumer stays idle', () => {
    const registry = new PtySessionRegistry();
    const onRendererIdle = vi.fn();
    registry.register('session', new FakePty(), { tmuxBacked: true, onRendererIdle });
    registry.subscribe('session', 'renderer');

    expect(
      registry.checkpointAndUnsubscribe('session', 'renderer', {
        buffer: '\x1bcIDLE FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);

    vi.advanceTimersByTime(PTY_RENDERER_DETACH_GRACE_MS - 1);
    expect(onRendererIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRendererIdle).toHaveBeenCalledOnce();
    expect(onRendererIdle).toHaveBeenCalledWith(1);
  });

  it('cancels a pending tmux renderer-idle notification when a new consumer subscribes', () => {
    const registry = new PtySessionRegistry();
    const onRendererIdle = vi.fn();
    registry.register('session', new FakePty(), { tmuxBacked: true, onRendererIdle });
    registry.subscribe('session', 'old-renderer');
    expect(
      registry.checkpointAndUnsubscribe('session', 'old-renderer', {
        buffer: '\x1bcIDLE FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);

    vi.advanceTimersByTime(PTY_RENDERER_DETACH_GRACE_MS - 1);
    registry.subscribe('session', 'new-renderer');
    vi.advanceTimersByTime(PTY_RENDERER_DETACH_GRACE_MS + 1);

    expect(onRendererIdle).not.toHaveBeenCalled();
    expect(registry.getDiagnostics('session')?.consumerCount).toBe(1);
  });

  it('does not run a stale renderer-idle notification after the session re-registers', () => {
    const registry = new PtySessionRegistry();
    const onOldRendererIdle = vi.fn();
    const onNewRendererIdle = vi.fn();
    registry.register('session', new FakePty(), {
      tmuxBacked: true,
      onRendererIdle: onOldRendererIdle,
    });
    registry.subscribe('session', 'renderer');
    expect(
      registry.checkpointAndUnsubscribe('session', 'renderer', {
        buffer: '\x1bcOLD FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);

    registry.register('session', new FakePty(), {
      tmuxBacked: true,
      onRendererIdle: onNewRendererIdle,
    });
    vi.advanceTimersByTime(PTY_RENDERER_DETACH_GRACE_MS);

    expect(onOldRendererIdle).not.toHaveBeenCalled();
    expect(onNewRendererIdle).not.toHaveBeenCalled();
    expect(registry.getGeneration('session')).toBe(2);
  });

  it('never notifies renderer idle for a non-tmux session', () => {
    const registry = new PtySessionRegistry();
    const onRendererIdle = vi.fn();
    registry.register('session', new FakePty(), { onRendererIdle });
    registry.subscribe('session', 'renderer');
    expect(
      registry.checkpointAndUnsubscribe('session', 'renderer', {
        buffer: '\x1bcDIRECT FRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);

    vi.advanceTimersByTime(PTY_RENDERER_DETACH_GRACE_MS * 2);

    expect(onRendererIdle).not.toHaveBeenCalled();
  });

  it('preserves the WebContents owner when a compact subscription falls back', async () => {
    const registry = new PtySessionRegistry();
    registry.register('session', new FakePty());
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcOLD GENERATION',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);

    const subscription = registry.subscribeForRenderer('session', 'renderer', 42);
    registry.register('session', new FakePty());
    await subscription;

    expect(registry.getDiagnostics('session')?.consumerCount).toBe(1);
    registry.unsubscribeOwner(42);
    expect(registry.getDiagnostics('session')?.consumerCount).toBe(0);
    registry.unregister('session');
  });

  it('commits pending cold output without broadcasting or advancing the watermark', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    pty.emitData('BEFORE');

    const snapshot = registry.subscribe('session', 'consumer');

    expect(snapshot).toEqual({
      buffer: 'BEFORE',
      generation: 1,
      sequence: 0,
    });
    expect(eventMocks.emit).not.toHaveBeenCalledWith(ptyDataChannel, expect.anything(), 'session');
  });

  it('returns all cold output in the snapshot then emits live output exactly once', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const coldOutput = 'cold-中😀'.repeat(
      Math.ceil((PTY_OUTPUT_BATCH_MAX_BYTES * 2.5) / Buffer.byteLength('cold-中😀', 'utf8'))
    );
    registry.register('session', pty);

    pty.emitData(coldOutput);
    expect(eventMocks.emit).not.toHaveBeenCalledWith(ptyDataChannel, expect.anything(), 'session');

    const snapshot = registry.subscribe('session', 'consumer');
    expect(snapshot).toEqual({ buffer: coldOutput, generation: 1, sequence: 0 });

    eventMocks.emit.mockClear();
    pty.emitData('live-😀');
    vi.advanceTimersByTime(16);

    expect(eventMocks.emit.mock.calls).toEqual([
      [
        ptyDataChannel,
        {
          generation: 1,
          sequence: 1,
          byteLength: Buffer.byteLength('live-😀', 'utf8'),
          data: 'live-😀',
        },
        'session',
      ],
    ]);
  });

  it('cancels stale output and input subscriptions when a session respawns', () => {
    const registry = new PtySessionRegistry();
    const oldPty = new FakePty();
    const newPty = new FakePty();
    expect(registry.getGeneration('session')).toBe(0);
    registry.register('session', oldPty);
    expect(registry.getGeneration('session')).toBe(1);
    oldPty.emitData('STALE');

    registry.register('session', newPty);
    expect(registry.getGeneration('session')).toBe(2);
    emitInput('session', 'input');
    vi.advanceTimersByTime(16);

    expect(oldPty.writes).toEqual([]);
    expect(newPty.writes).toEqual(['input']);
    expect(eventMocks.emit).not.toHaveBeenCalledWith(
      ptyDataChannel,
      expect.objectContaining({ data: 'STALE' }),
      'session'
    );
    expect(registry.subscribe('session', 'consumer')).toMatchObject({
      buffer: '',
      generation: 2,
      sequence: 0,
    });
  });

  it('invalidates an attached consumer at generation start before the first output byte', () => {
    const registry = new PtySessionRegistry();
    registry.register('session', new FakePty());
    registry.subscribe('session', 'attached-renderer');
    eventMocks.emit.mockClear();

    registry.register('session', new FakePty());

    expect(eventMocks.emit.mock.calls).toContainEqual([
      ptyDataChannel,
      { generation: 2, sequence: 0, byteLength: 0, data: '' },
      'session',
    ]);
  });

  it('serializes exact-generation reveal claims against backend replacement', async () => {
    const registry = new PtySessionRegistry();
    registry.register('session', new FakePty());
    registry.subscribe('session', 'renderer', { ownerWebContentsId: 41 });

    const claim = registry.claimGenerationReveal('session', 'renderer', 1, 41);
    expect(claim).toMatchObject({ generation: 1 });
    if (!claim) throw new Error('Expected exact-generation reveal claim');

    const replacementEpoch = registry.beginRegistration('session');
    expect(registry.claimGenerationReveal('session', 'renderer', 1, 41)).toBeNull();

    let replacementUnblocked = false;
    const replacementFence = registry
      .waitForRevealClaims('session', replacementEpoch)
      .then((owned) => {
        replacementUnblocked = true;
        return owned;
      });
    await Promise.resolve();
    expect(replacementUnblocked).toBe(false);
    expect(() =>
      registry.register('session', new FakePty(), { registrationEpoch: replacementEpoch })
    ).toThrow(/generation reveal is claimed/);

    expect(registry.releaseGenerationReveal(claim.token, 99)).toBe(false);
    expect(replacementUnblocked).toBe(false);
    expect(registry.releaseGenerationReveal(claim.token, 41)).toBe(true);
    await expect(replacementFence).resolves.toBe(true);

    registry.register('session', new FakePty(), { registrationEpoch: replacementEpoch });
    expect(registry.getGeneration('session')).toBe(2);
  });

  it('expires a reveal claim so a waiting replacement can register', async () => {
    const registry = new PtySessionRegistry();
    registry.register('session', new FakePty());
    registry.subscribe('session', 'renderer', { ownerWebContentsId: 41 });

    const claim = registry.claimGenerationReveal('session', 'renderer', 1, 41);
    if (!claim) throw new Error('Expected exact-generation reveal claim');

    const replacementEpoch = registry.beginRegistration('session');
    let replacementUnblocked = false;
    const replacementFence = registry
      .waitForRevealClaims('session', replacementEpoch)
      .then((owned) => {
        replacementUnblocked = true;
        return owned;
      });
    await Promise.resolve();
    expect(replacementUnblocked).toBe(false);

    await vi.advanceTimersByTimeAsync(PTY_GENERATION_REVEAL_CLAIM_TIMEOUT_MS - 1);
    expect(replacementUnblocked).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(replacementFence).resolves.toBe(true);
    expect(registry.releaseGenerationReveal(claim.token, 41)).toBe(false);

    const replacement = new FakePty();
    registry.register('session', replacement, { registrationEpoch: replacementEpoch });
    expect(registry.getGeneration('session')).toBe(2);
    expect(registry.get('session')).toBe(replacement);
  });

  it('releases a reveal claim with its renderer consumer and owner lifecycle', () => {
    const registry = new PtySessionRegistry();
    registry.register('consumer-session', new FakePty());
    registry.subscribe('consumer-session', 'renderer', { ownerWebContentsId: 41 });
    const consumerClaim = registry.claimGenerationReveal('consumer-session', 'renderer', 1, 41);
    if (!consumerClaim) throw new Error('Expected consumer reveal claim');

    registry.unsubscribe('consumer-session', 'renderer');
    expect(registry.releaseGenerationReveal(consumerClaim.token, 41)).toBe(false);

    registry.register('owner-session', new FakePty());
    registry.subscribe('owner-session', 'renderer', { ownerWebContentsId: 41 });
    const ownerClaim = registry.claimGenerationReveal('owner-session', 'renderer', 1, 41);
    if (!ownerClaim) throw new Error('Expected owner reveal claim');

    registry.unsubscribeOwner(41);
    expect(registry.releaseGenerationReveal(ownerClaim.token, 41)).toBe(false);
  });

  it('replays ordered input typed just before the backend PTY registers', () => {
    const registry = new PtySessionRegistry();
    const registrationEpoch = registry.beginRegistration('session');
    expect(registry.writeOrQueue('session', 'first')).toBe('queued');
    expect(registry.writeOrQueue('session', '-second')).toBe('queued');

    const pty = new FakePty();
    registry.register('session', pty, { registrationEpoch });

    expect(pty.writes).toEqual(['first', '-second']);
    expect(registry.writeOrQueue('session', '-live')).toBe('written');
    expect(pty.writes).toEqual(['first', '-second', '-live']);
  });

  it('records activity only when input is delivered to the PTY', () => {
    vi.setSystemTime(1_000);
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty, { tmuxBacked: true });

    expect(registry.getDiagnostics('session')?.lastInputAt).toBeNull();
    registry.writeOrQueue('session', '\x1b[>0;276;0c');
    expect(registry.getDiagnostics('session')?.lastInputAt).toBeNull();

    vi.setSystemTime(2_000);
    registry.writeOrQueue('session', 'user input');

    expect(registry.getDiagnostics('session')?.lastInputAt).toBe(2_000);
    expect(pty.writes).toEqual(['user input']);
  });

  it('filters duplicate xterm identification replies only for tmux-backed sessions', () => {
    const registry = new PtySessionRegistry();
    const tmuxPty = new FakePty();
    const directPty = new FakePty();
    const terminalReplies = '\x1b[>0;276;0c\x1bP>|xterm.js(6.1.0-beta.292)\x1b\\user input';

    registry.register('tmux-session', tmuxPty, { tmuxBacked: true });
    registry.register('direct-session', directPty);

    expect(registry.writeOrQueue('tmux-session', terminalReplies)).toBe('written');
    expect(registry.writeOrQueue('direct-session', terminalReplies)).toBe('written');
    expect(tmuxPty.writes).toEqual(['user input']);
    expect(directPty.writes).toEqual([terminalReplies]);
  });

  it('filters split xterm replies queued before a tmux PTY registers', () => {
    const registry = new PtySessionRegistry();
    const registrationEpoch = registry.beginRegistration('session');

    expect(registry.writeOrQueue('session', 'before\x1b[>0;')).toBe('queued');
    expect(registry.writeOrQueue('session', '276;0c\x1bP>|xterm.js(6.1.0-')).toBe('queued');
    expect(registry.writeOrQueue('session', 'beta.292)\x1b\\after')).toBe('queued');

    const pty = new FakePty();
    registry.register('session', pty, { registrationEpoch, tmuxBacked: true });

    expect(pty.writes).toEqual(['before', 'after']);
  });

  it('filters tmux replies received through the legacy input event path', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty, { tmuxBacked: true });

    emitInput('session', '\x1b[?1;2cvisible');

    expect(pty.writes).toEqual(['visible']);
  });

  it('exposes whether an outer creation registration is still current', () => {
    const registry = new PtySessionRegistry();
    const epoch = registry.beginRegistration('session');

    expect(registry.isRegistrationCurrent('session', epoch)).toBe(true);
    registry.unregister('session');
    expect(registry.isRegistrationCurrent('session', epoch)).toBe(false);

    const nextEpoch = registry.beginRegistration('session');
    expect(nextEpoch).toBeGreaterThan(epoch);
    expect(registry.isRegistrationCurrent('session', epoch)).toBe(false);
    expect(registry.isRegistrationCurrent('session', nextEpoch)).toBe(true);
  });

  it('exposes an in-flight registration before a live PTY exists', () => {
    const registry = new PtySessionRegistry();

    registry.beginRegistration('session');

    expect(registry.getDiagnostics('session')).toMatchObject({
      sessionId: 'session',
      live: false,
      registering: true,
      consumerCount: 0,
    });
  });

  it('exposes listener-first consumers before a live PTY exists', () => {
    const registry = new PtySessionRegistry();

    registry.subscribe('session', 'consumer');

    expect(registry.getDiagnostics('session')).toMatchObject({
      sessionId: 'session',
      live: false,
      registering: false,
      consumerCount: 1,
    });
  });

  it('expires input instead of replaying stale keystrokes into a later process', () => {
    const registry = new PtySessionRegistry();
    registry.beginRegistration('session');
    registry.writeOrQueue('session', 'stale');
    vi.advanceTimersByTime(30_000);

    const pty = new FakePty();
    registry.register('session', pty);

    expect(pty.writes).toEqual([]);
  });

  it('anchors pending input expiry to the first chunk instead of extending it', () => {
    const registry = new PtySessionRegistry();
    registry.beginRegistration('session');
    registry.writeOrQueue('session', 'first');
    vi.advanceTimersByTime(29_999);
    registry.writeOrQueue('session', '-late');
    vi.advanceTimersByTime(1);

    const pty = new FakePty();
    registry.register('session', pty);

    expect(pty.writes).toEqual([]);
  });

  it('clears pending input when a session is explicitly unregistered', () => {
    const registry = new PtySessionRegistry();
    registry.beginRegistration('session');
    registry.writeOrQueue('session', 'stale');

    registry.unregister('session');
    const pty = new FakePty();
    registry.register('session', pty);

    expect(pty.writes).toEqual([]);
  });

  it('bounds pending input sessions and does not allocate one for empty input', () => {
    const registry = new PtySessionRegistry();
    registry.beginRegistration('empty-session');
    expect(registry.writeOrQueue('empty-session', '')).toBe('queued');

    for (let index = 0; index < PTY_PENDING_INPUT_MAX_SESSIONS; index += 1) {
      registry.beginRegistration(`session-${index}`);
      expect(registry.writeOrQueue(`session-${index}`, 'x')).toBe('queued');
    }
    registry.beginRegistration('overflow-session');
    expect(registry.writeOrQueue('overflow-session', 'x')).toBe('full');
  });

  it('coalesces pending input to keep chunk cardinality bounded', () => {
    const registry = new PtySessionRegistry();
    const registrationEpoch = registry.beginRegistration('session');
    const input = 'x'.repeat(PTY_PENDING_INPUT_MAX_CHUNKS * 2 + 5);
    for (const character of input) {
      expect(registry.writeOrQueue('session', character)).toBe('queued');
    }

    const pty = new FakePty();
    registry.register('session', pty, { registrationEpoch });

    expect(pty.writes.join('')).toBe(input);
    expect(pty.writes.length).toBeLessThanOrEqual(PTY_PENDING_INPUT_MAX_CHUNKS);
  });

  it('rejects input after exit and only queues input inside the next registration epoch', () => {
    const registry = new PtySessionRegistry();
    const firstEpoch = registry.beginRegistration('session');
    const firstPty = new FakePty();
    registry.register('session', firstPty, { registrationEpoch: firstEpoch });
    firstPty.emitExit({ exitCode: 0 });

    expect(registry.writeOrQueue('session', 'late-old-input')).toBe('unavailable');

    const secondEpoch = registry.beginRegistration('session');
    expect(registry.writeOrQueue('session', 'next-input')).toBe('queued');
    const secondPty = new FakePty();
    registry.register('session', secondPty, { registrationEpoch: secondEpoch });

    expect(secondPty.writes).toEqual(['next-input']);
  });

  it('flushes output before exit and leaves no late timer behind', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const onFinalExit = vi.fn();
    registry.register('session', pty, { onFinalExit });
    registry.subscribe('session', 'consumer');
    pty.emitData('tail');
    pty.emitExit({ exitCode: 7 });
    vi.advanceTimersByTime(16);

    expect(eventMocks.emit.mock.calls).toEqual([
      [ptyDataChannel, { generation: 1, sequence: 1, byteLength: 4, data: 'tail' }, 'session'],
      [ptyExitChannel, { exitCode: 7, generation: 1 }, 'session'],
    ]);
    expect(onFinalExit).toHaveBeenCalledWith({ exitCode: 7 }, 1);
    expect(onFinalExit.mock.invocationCallOrder[0]).toBeGreaterThan(
      eventMocks.emit.mock.invocationCallOrder.at(-1) ?? 0
    );
  });

  it('bounds replay by UTF-8 bytes without creating broken surrogate pairs', () => {
    const registry = new PtySessionRegistry();
    registry.setScrollbackLines(1);
    const cap = getTerminalRingBufferCapBytes(1);
    const pty = new FakePty();
    registry.register('session', pty);
    pty.emitData(`prefix-${'中😀'.repeat(Math.ceil(cap / 4))}`);

    const snapshot = registry.snapshot('session');

    expect(Buffer.byteLength(snapshot, 'utf8')).toBeLessThanOrEqual(cap);
    expect(hasUnpairedSurrogate(snapshot)).toBe(false);
    expect(snapshot).not.toContain('\uFFFD');
  });

  it('evicts only the overflow instead of dropping an entire replay chunk', () => {
    const registry = new PtySessionRegistry();
    registry.setScrollbackLines(1);
    const cap = getTerminalRingBufferCapBytes(1);
    const pty = new FakePty();
    registry.register('session', pty);
    pty.emitData('a'.repeat(cap - 10));
    pty.emitData('b'.repeat(20));

    const snapshot = registry.snapshot('session');

    expect(Buffer.byteLength(snapshot, 'utf8')).toBe(cap);
    expect(snapshot).toBe(`${'a'.repeat(cap - 20)}${'b'.repeat(20)}`);
  });

  it('pauses above the xterm write high-water mark and resumes after cumulative ACK', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).toHaveBeenCalledTimes(1);
    registry.acknowledge(
      'session',
      'consumer',
      1,
      PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES
    );
    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('terminates and detaches a producer when transport pause fails', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const onFinalExit = vi.fn();
    pty.pause.mockImplementation(() => {
      throw new Error('pause failed');
    });
    registry.register('session', pty, { onFinalExit });
    registry.subscribe('session', 'consumer');
    expect(
      registry.saveRenderCheckpoint('session', {
        buffer: '\x1bcFRAME',
        generation: 1,
        sequence: 0,
        cols: 80,
        rows: 24,
        canonical: true,
        scrollbackLines: 100,
      })
    ).toBe(true);
    eventMocks.emit.mockClear();

    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).toHaveBeenCalledTimes(1);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(pty.resume).not.toHaveBeenCalled();
    expect(onFinalExit).toHaveBeenCalledWith({ signal: 'PTY_FLOW_CONTROL_FAILURE' }, 1);
    expect(eventMocks.emit.mock.calls.at(-1)?.[0]).toBe(ptyExitChannel);
    expect(registry.getDiagnostics('session')).toBeNull();

    // Even a broken backend that emits after kill is detached from the
    // registry, so it cannot refill an unbounded pending queue.
    pty.emitData('y'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    expect(registry.getDiagnostics('session')).toBeNull();
  });

  it('waits for the slowest consumer ACK before releasing flow control', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'fast-consumer');
    registry.subscribe('session', 'slow-consumer');

    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    const finalSequence = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;

    expect(pty.pause).toHaveBeenCalledTimes(1);
    registry.acknowledge('session', 'fast-consumer', 1, finalSequence);
    expect(pty.resume).not.toHaveBeenCalled();

    registry.acknowledge('session', 'slow-consumer', 1, finalSequence);
    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('releases a crashed WebContents owner from flow control in the same turn', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const finalSequence = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;
    registry.register('session', pty);
    registry.subscribe('session', 'crashed-consumer', { ownerWebContentsId: 11 });
    registry.subscribe('session', 'live-consumer', { ownerWebContentsId: 12 });
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    registry.acknowledge('session', 'live-consumer', 1, finalSequence);
    expect(pty.pause).toHaveBeenCalledTimes(1);
    expect(pty.resume).not.toHaveBeenCalled();

    registry.unsubscribeOwner(11);

    expect(pty.resume).toHaveBeenCalledTimes(1);
    expect(registry.getDiagnostics('session')?.consumerCount).toBe(1);
    registry.unsubscribeOwner(12);
  });

  it('rejects invalid ACK watermarks without poisoning a later valid ACK', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    const finalSequence = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES;

    registry.acknowledge('session', 'consumer', 1, Number.NaN);
    registry.acknowledge('session', 'consumer', 1, finalSequence);

    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('makes unsubscribe idempotent and scoped to its consumer token', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'first-consumer');
    registry.subscribe('session', 'remaining-consumer');

    registry.unsubscribe('session', 'first-consumer');
    registry.unsubscribe('session', 'first-consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).toHaveBeenCalledTimes(1);
    registry.unsubscribe('session', 'remaining-consumer');
    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('caps every output batch at 64 KiB without splitting UTF-8 characters', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    const output = '中😀'.repeat(Math.ceil((PTY_OUTPUT_BATCH_MAX_BYTES * 2.5) / 7));
    const outputBytes = Buffer.byteLength(output, 'utf8');
    const expectedBatchCount = Math.ceil(outputBytes / PTY_OUTPUT_BATCH_MAX_BYTES);

    pty.emitData(output);
    vi.advanceTimersByTime(16);

    const batches = eventMocks.emit.mock.calls
      .filter(([event]) => event === ptyDataChannel)
      .map(([, payload]) => payload as { byteLength: number; data: string });
    expect(batches).toHaveLength(expectedBatchCount);
    expect(batches.every((batch) => batch.byteLength <= PTY_OUTPUT_BATCH_MAX_BYTES)).toBe(true);
    expect(batches.map((batch) => batch.data).join('')).toBe(output);
    expect(batches.some((batch) => batch.data.includes('\uFFFD'))).toBe(false);
  });

  it('expires a stalled consumer lease and resumes a paused PTY', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'stalled-consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    expect(pty.pause).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS);

    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying resume with capped backoff until it succeeds', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES + PTY_OUTPUT_BATCH_MAX_BYTES));
    let remainingFailures = 8;
    pty.resume.mockImplementation(() => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error('transient resume failure');
      }
    });

    registry.unsubscribe('session', 'consumer');

    expect(pty.resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24);
    expect(pty.resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_551);
    expect(pty.resume).toHaveBeenCalledTimes(9);
    vi.advanceTimersByTime(1);

    const emittedByteLength = eventMocks.emit.mock.calls
      .filter(([event]) => event === ptyDataChannel)
      .reduce((total, [, payload]) => total + (payload as { byteLength: number }).byteLength, 0);
    expect(emittedByteLength).toBe(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES);
    expect(registry.subscribe('session', 'next-consumer')).toMatchObject({
      buffer: 'x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES + PTY_OUTPUT_BATCH_MAX_BYTES),
      generation: 1,
      sequence: PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES / PTY_OUTPUT_BATCH_MAX_BYTES,
    });
  });

  it('does not recreate a consumer when heartbeat arrives after unsubscribe', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    registry.unsubscribe('session', 'consumer');

    // The report back is the renderer's only way to learn it was detached.
    expect(registry.heartbeat('session', 'consumer', 1, 0)).toEqual({ known: false });
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).not.toHaveBeenCalled();
  });

  it('does not recreate an expired consumer when a late heartbeat arrives', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS);

    expect(registry.heartbeat('session', 'consumer', 1, 0)).toEqual({ known: false });
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).not.toHaveBeenCalled();
  });

  it('does not renew a consumer lease with an invalid heartbeat watermark', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS - 1);
    // The renewal is refused, but the registration exists — reporting it missing
    // would send the renderer resubscribing over a bad watermark alone.
    expect(registry.heartbeat('session', 'consumer', 1, Number.POSITIVE_INFINITY)).toEqual({
      known: true,
    });
    vi.advanceTimersByTime(1);

    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('honors a renewed lease after the originally scheduled sweep wakes early', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'live-consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));
    expect(pty.pause).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS - 10_000);
    registry.heartbeat('session', 'live-consumer', 1, 0);
    vi.advanceTimersByTime(10_000);
    expect(pty.resume).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS - 10_000);
    expect(pty.resume).toHaveBeenCalledTimes(1);
  });

  it('clears a large cold IPC queue without broadcasting while preserving replay', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const outputByteLength = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES * 8;
    registry.register('session', pty);

    pty.emitData('x'.repeat(outputByteLength));

    const emittedData = (): unknown[][] =>
      eventMocks.emit.mock.calls.filter(([event]) => event === ptyDataChannel);
    expect(emittedData()).toHaveLength(0);
    expect(registry.getDiagnostics('session')?.pendingOutputBytes).toBe(0);
    expect(registry.subscribe('session', 'consumer')).toMatchObject({
      buffer: 'x'.repeat(outputByteLength),
      generation: 1,
      sequence: 0,
    });
  });

  it('does not rebroadcast cold output after returning it in the subscribe snapshot', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const outputByteLength = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES + PTY_OUTPUT_BATCH_MAX_BYTES * 2;
    registry.register('session', pty);
    pty.emitData('x'.repeat(outputByteLength));

    const snapshot = registry.subscribe('session', 'consumer');
    vi.advanceTimersByTime(0);

    const dataBatches = eventMocks.emit.mock.calls
      .filter(([event]) => event === ptyDataChannel)
      .map(([, payload]) => {
        const batch = payload as { byteLength: number; sequence: number };
        return { byteLength: batch.byteLength, sequence: batch.sequence };
      });
    expect(snapshot.sequence).toBe(0);
    expect(Buffer.byteLength(snapshot.buffer, 'utf8')).toBe(outputByteLength);
    expect(dataBatches).toEqual([]);
  });

  it('finalizes exactly once when subscribe drains the final exit batch', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const output = 'x'.repeat(
      PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES + PTY_OUTPUT_BATCH_MAX_BYTES * 2
    );
    registry.register('session', pty);
    pty.emitData(output);
    pty.emitExit({ exitCode: 7 });

    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      0
    );
    const snapshot = registry.subscribe('session', 'consumer');

    expect(snapshot.buffer).toBe(output);
    expect(snapshot.sequence).toBe(0);
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      1
    );
    expect(registry.get('session')).toBeUndefined();
    vi.runAllTimers();
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      1
    );
  });

  it('finalizes a non-persistent cold exit on the next tick without a subscriber', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    pty.emitData('cold tail');

    pty.emitExit({ exitCode: 7 });
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      0
    );

    vi.advanceTimersByTime(0);

    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toEqual([
      [ptyExitChannel, { exitCode: 7, generation: 1 }, 'session'],
    ]);
    expect(registry.getDiagnostics('session')).toBeNull();
  });

  it('never emits past the high watermark for one huge tick or a subscribe while paused', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'slow-consumer');

    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES * 4));

    const emittedBeforeSubscribe = eventMocks.emit.mock.calls.filter(
      ([event]) => event === ptyDataChannel
    );
    expect(
      emittedBeforeSubscribe.reduce(
        (total, [, payload]) => total + (payload as { byteLength: number }).byteLength,
        0
      )
    ).toBe(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES);
    expect(pty.pause).toHaveBeenCalledTimes(1);

    const snapshot = registry.subscribe('session', 'late-consumer');

    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyDataChannel)).toHaveLength(
      emittedBeforeSubscribe.length
    );
    expect(Buffer.byteLength(snapshot.buffer, 'utf8')).toBe(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES);
  });

  it('does not overshoot the remaining flow-control budget during subscribe', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const slack = 10 * 1024;
    registry.register('session', pty);
    registry.subscribe('session', 'existing-consumer');
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES - slack));
    vi.advanceTimersByTime(16);

    pty.emitData('y'.repeat(slack * 2));
    registry.subscribe('session', 'late-consumer');

    const emittedByteLength = eventMocks.emit.mock.calls
      .filter(([event]) => event === ptyDataChannel)
      .reduce((total, [, payload]) => total + (payload as { byteLength: number }).byteLength, 0);
    expect(emittedByteLength).toBe(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES);
    expect(pty.pause).toHaveBeenCalledTimes(1);
  });

  it('drains all old-generation output and exit before an immediate same-id replacement', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    const replacementPty = new FakePty();
    const outputByteLength = PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES * 8;
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');

    pty.emitData('x'.repeat(outputByteLength));
    pty.emitExit({ exitCode: 7 });
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      0
    );
    registry.register('session', replacementPty);

    const dataBatches = eventMocks.emit.mock.calls
      .filter(([event]) => event === ptyDataChannel)
      .map(
        ([, payload]) => payload as { byteLength: number; generation: number; sequence: number }
      );
    const oldGenerationBatches = dataBatches.filter((batch) => batch.generation === 1);
    expect(
      oldGenerationBatches.every((batch) => batch.byteLength <= PTY_OUTPUT_BATCH_MAX_BYTES)
    ).toBe(true);
    expect(oldGenerationBatches.reduce((total, batch) => total + batch.byteLength, 0)).toBe(
      outputByteLength
    );
    const exitCallIndex = eventMocks.emit.mock.calls.findIndex(
      ([event]) => event === ptyExitChannel
    );
    const finalOldDataCallIndex = eventMocks.emit.mock.calls
      .map(([event, payload], index) =>
        event === ptyDataChannel && (payload as { generation?: number }).generation === 1
          ? index
          : -1
      )
      .reduce((latest, index) => Math.max(latest, index), -1);
    const generationStartCallIndex = eventMocks.emit.mock.calls.findIndex(
      ([event, payload]) =>
        event === ptyDataChannel && (payload as { generation?: number }).generation === 2
    );
    expect(exitCallIndex).toBe(finalOldDataCallIndex + 1);
    expect(generationStartCallIndex).toBe(exitCallIndex + 1);
    expect(eventMocks.emit.mock.calls[exitCallIndex]).toEqual([
      ptyExitChannel,
      { exitCode: 7, generation: 1 },
      'session',
    ]);
    expect(registry.get('session')).toBe(replacementPty);
    expect(registry.subscribe('session', 'replacement-consumer')).toMatchObject({
      generation: 2,
      sequence: 0,
    });
    vi.runAllTimers();
    expect(eventMocks.emit.mock.calls.filter(([event]) => event === ptyExitChannel)).toHaveLength(
      1
    );
  });
});
