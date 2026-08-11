import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyDataChannel, ptyExitChannel, ptyInputChannel } from '@shared/events/ptyEvents';
import { getTerminalRingBufferCapBytes } from '@shared/terminal-settings';
import type { Pty, PtyExitInfo } from './pty';
import {
  PTY_CONSUMER_LEASE_TIMEOUT_MS,
  PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES,
  PTY_OUTPUT_BATCH_MAX_BYTES,
  PTY_PENDING_INPUT_MAX_CHUNKS,
  PTY_PENDING_INPUT_MAX_SESSIONS,
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
    warn: vi.fn(),
  },
}));

class FakePty implements Pty {
  readonly writes: string[] = [];
  readonly pause = vi.fn();
  readonly resume = vi.fn();
  readonly kill = vi.fn();
  private dataHandler: ((data: string) => void) | null = null;
  private exitHandler: ((info: PtyExitInfo) => void) | null = null;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {}

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
    registry.register('session', oldPty);
    oldPty.emitData('STALE');

    registry.register('session', newPty);
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
      [ptyExitChannel, { exitCode: 7 }, 'session'],
    ]);
    expect(onFinalExit).toHaveBeenCalledWith({ exitCode: 7 });
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

    registry.heartbeat('session', 'consumer', 1, 0);
    pty.emitData('x'.repeat(PTY_FLOW_CONTROL_HIGH_WATERMARK_BYTES));

    expect(pty.pause).not.toHaveBeenCalled();
  });

  it('does not recreate an expired consumer when a late heartbeat arrives', () => {
    const registry = new PtySessionRegistry();
    const pty = new FakePty();
    registry.register('session', pty);
    registry.subscribe('session', 'consumer');
    vi.advanceTimersByTime(PTY_CONSUMER_LEASE_TIMEOUT_MS);

    registry.heartbeat('session', 'consumer', 1, 0);
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
    registry.heartbeat('session', 'consumer', 1, Number.POSITIVE_INFINITY);
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
      [ptyExitChannel, { exitCode: 7 }, 'session'],
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
    expect(dataBatches.every((batch) => batch.byteLength <= PTY_OUTPUT_BATCH_MAX_BYTES)).toBe(true);
    expect(dataBatches.every((batch) => batch.generation === 1)).toBe(true);
    expect(dataBatches.reduce((total, batch) => total + batch.byteLength, 0)).toBe(
      outputByteLength
    );
    const exitCallIndex = eventMocks.emit.mock.calls.findIndex(
      ([event]) => event === ptyExitChannel
    );
    const finalDataCallIndex = eventMocks.emit.mock.calls
      .map(([event]) => event)
      .lastIndexOf(ptyDataChannel);
    expect(exitCallIndex).toBe(finalDataCallIndex + 1);
    expect(eventMocks.emit.mock.calls[exitCallIndex]).toEqual([
      ptyExitChannel,
      { exitCode: 7 },
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
