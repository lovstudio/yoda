import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PtyDataEvent } from '@shared/events/ptyEvents';
import { FrontendPty, XTERM_WRITE_CHUNK_CODE_UNITS } from '@renderer/lib/pty/pty';

const ipcMocks = vi.hoisted(() => {
  let dataListener: ((event: PtyDataEvent) => void) | null = null;
  return {
    acknowledgeOutput: vi.fn(
      (_sessionId: string, _consumerId: string, _generation: number, _sequence: number) =>
        Promise.resolve()
    ),
    heartbeatConsumer: vi.fn(
      (
        _sessionId: string,
        _consumerId: string,
        _generation: number,
        _acknowledgedSequence: number
      ) => Promise.resolve()
    ),
    unsubscribe: vi.fn((_sessionId: string, _consumerId: string) => Promise.resolve()),
    subscribe: vi.fn(),
    listenerDisposals: [] as Array<ReturnType<typeof vi.fn>>,
    setDataListener(listener: (event: PtyDataEvent) => void) {
      dataListener = listener;
      const dispose = vi.fn(() => {
        if (dataListener === listener) dataListener = null;
      });
      this.listenerDisposals.push(dispose);
      return dispose;
    },
    emitData(event: PtyDataEvent) {
      dataListener?.(event);
    },
    clearDataListener() {
      dataListener = null;
    },
  };
});

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_event: unknown, listener: (event: PtyDataEvent) => void) =>
      ipcMocks.setDataListener(listener)
    ),
  },
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
    pty: {
      subscribe: ipcMocks.subscribe,
      acknowledgeOutput: ipcMocks.acknowledgeOutput,
      heartbeatConsumer: ipcMocks.heartbeatConsumer,
      unsubscribe: ipcMocks.unsubscribe,
    },
  },
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

function output(sequence: number, data: string): PtyDataEvent {
  return {
    generation: 1,
    sequence,
    byteLength: new TextEncoder().encode(data).byteLength,
    data,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error('Deferred promise is not initialised');
      resolvePromise(value);
    },
  };
}

describe('FrontendPty stream ordering', () => {
  let pty: FrontendPty | null = null;
  let mountTarget: HTMLDivElement | null = null;

  function mountAndOpenFlushGate(target: FrontendPty): number {
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    const lease = target.mount(mountTarget, { cols: 120, rows: 32 });
    target.flushPendingWrites();
    return lease;
  }

  afterEach(() => {
    pty?.dispose();
    pty = null;
    mountTarget?.remove();
    mountTarget = null;
    ipcMocks.subscribe.mockReset();
    ipcMocks.acknowledgeOutput.mockClear();
    ipcMocks.heartbeatConsumer.mockClear();
    ipcMocks.unsubscribe.mockClear();
    ipcMocks.listenerDisposals.length = 0;
    ipcMocks.clearDataListener();
  });

  it('does not create a consumer before mount and the real-size flush gate', async () => {
    pty = new FrontendPty('prepared-only-session');

    await pty.connect();

    expect(ipcMocks.subscribe).not.toHaveBeenCalled();
    expect(ipcMocks.heartbeatConsumer).not.toHaveBeenCalled();
    pty.dispose();
    expect(ipcMocks.unsubscribe).not.toHaveBeenCalled();
    pty = null;
  });

  it('joins snapshot and live output exactly once across the subscribe race', async () => {
    ipcMocks.subscribe.mockImplementation(async () => {
      // seq=1 is already represented by the returned snapshot. seq=2 arrives
      // after that snapshot was taken but before the RPC promise resolves.
      ipcMocks.emitData(output(1, 'BEFORE'));
      ipcMocks.emitData(output(2, 'BOUNDARY'));
      return {
        success: true,
        data: { buffer: 'BEFORE', generation: 1, sequence: 1 },
      };
    });

    pty = new FrontendPty('ordered-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    ipcMocks.emitData(output(3, 'AFTER'));

    await vi.waitFor(() => {
      const rendered = pty?.terminal.buffer.active.getLine(0)?.translateToString(true);
      expect(rendered).toBe('BEFOREBOUNDARYAFTER');
    });
    const consumerId = ipcMocks.subscribe.mock.calls[0]?.[1];
    expect(consumerId).toEqual(expect.any(String));
    await vi.waitFor(() => {
      expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith('ordered-session', consumerId, 1, 3);
    });
  });

  it('drops late output from a previous backend generation', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 2, sequence: 0 },
    });

    pty = new FrontendPty('respawned-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    ipcMocks.emitData({ ...output(99, 'STALE'), generation: 1 });
    ipcMocks.emitData({ ...output(1, 'FRESH'), generation: 2 });

    await vi.waitFor(() => {
      const rendered = pty?.terminal.buffer.active.getLine(0)?.translateToString(true);
      expect(rendered).toBe('FRESH');
    });
  });

  it('cancels a pending first subscription on unmount and discards its snapshot', async () => {
    const pendingSubscribe = deferred<{
      success: true;
      data: { buffer: string; generation: number; sequence: number };
    }>();
    ipcMocks.subscribe.mockReturnValue(pendingSubscribe.promise);
    pty = new FrontendPty('cancel-pending-session');
    const lease = mountAndOpenFlushGate(pty);

    const connectPromise = pty.connect();
    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());
    const consumerId = ipcMocks.subscribe.mock.calls[0]?.[1];
    ipcMocks.emitData(output(8, 'LIVE-BEFORE-CANCEL'));

    pty.unmount(lease);

    expect(ipcMocks.unsubscribe).toHaveBeenCalledOnce();
    expect(ipcMocks.unsubscribe).toHaveBeenCalledWith('cancel-pending-session', consumerId);
    expect(ipcMocks.listenerDisposals[0]).toHaveBeenCalledOnce();

    pendingSubscribe.resolve({
      success: true,
      data: { buffer: 'STALE-SNAPSHOT', generation: 1, sequence: 7 },
    });
    await connectPromise;

    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true) ?? '').toBe('');
    expect(ipcMocks.acknowledgeOutput).not.toHaveBeenCalled();
    expect(ipcMocks.heartbeatConsumer).not.toHaveBeenCalled();

    pty.dispose();
    expect(ipcMocks.unsubscribe).toHaveBeenCalledOnce();
    pty = null;
  });

  it('suspends xterm parsing while off-screen and resumes the queued stream on remount', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('offscreen-connected-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();

    pty.unmount(lease);
    ipcMocks.emitData(output(1, 'OFFSCREEN'));

    await Promise.resolve();
    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true) ?? '').toBe('');
    expect(ipcMocks.acknowledgeOutput).not.toHaveBeenCalled();
    expect(ipcMocks.unsubscribe).not.toHaveBeenCalled();

    const remountLease = pty.mount(mountTarget!, { cols: 120, rows: 32 });
    await vi.waitFor(() => {
      expect(pty?.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('OFFSCREEN');
      expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith(
        'offscreen-connected-session',
        expect.any(String),
        1,
        1
      );
    });
    pty.unmount(remountLease);
  });

  it('chunks a 25 MiB snapshot and large live batch without advancing ACKs early', async () => {
    const snapshot = `S${'x'.repeat(25 * 1024 * 1024 - 2)}E`;
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: snapshot, generation: 1, sequence: 400 },
    });
    pty = new FrontendPty('chunked-output-session');
    const writes: Array<{ data: string; callback?: () => void }> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((data, callback) => {
      writes.push({
        data: typeof data === 'string' ? data : new TextDecoder().decode(data),
        callback,
      });
    });
    mountAndOpenFlushGate(pty);

    await pty.connect();

    // The serial pump keeps at most one parser job in xterm's queue.
    expect(writes).toHaveLength(1);
    expect(ipcMocks.acknowledgeOutput).not.toHaveBeenCalled();

    const live = `L${'y'.repeat(XTERM_WRITE_CHUNK_CODE_UNITS * 2)}Z`;
    ipcMocks.emitData(output(401, live));
    expect(writes).toHaveLength(1);

    const snapshotChunks: string[] = [];
    let nextWriteIndex = 0;
    while (ipcMocks.acknowledgeOutput.mock.calls.length === 0) {
      const write = writes[nextWriteIndex];
      if (!write?.callback) throw new Error('Snapshot parser chunk did not expose its completion');
      expect(write.data.length).toBeLessThanOrEqual(XTERM_WRITE_CHUNK_CODE_UNITS);
      snapshotChunks.push(write.data);
      nextWriteIndex += 1;
      write.callback();
    }
    expect(snapshotChunks).toHaveLength(snapshot.length / XTERM_WRITE_CHUNK_CODE_UNITS);
    expect(snapshotChunks[0]?.startsWith('S')).toBe(true);
    expect(snapshotChunks.at(-1)?.endsWith('E')).toBe(true);
    expect(snapshotChunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(snapshot.length);
    expect(ipcMocks.acknowledgeOutput).toHaveBeenLastCalledWith(
      'chunked-output-session',
      expect.any(String),
      1,
      400
    );

    const liveChunks: string[] = [];
    while (ipcMocks.acknowledgeOutput.mock.calls.length === 1) {
      const write = writes[nextWriteIndex];
      if (!write?.callback) throw new Error('Live parser chunk did not expose its completion');
      expect(write.data.length).toBeLessThanOrEqual(XTERM_WRITE_CHUNK_CODE_UNITS);
      liveChunks.push(write.data);
      nextWriteIndex += 1;
      write.callback();
    }
    expect(liveChunks).toHaveLength(3);
    expect(liveChunks.join('')).toBe(live);
    expect(ipcMocks.acknowledgeOutput).toHaveBeenLastCalledWith(
      'chunked-output-session',
      expect.any(String),
      1,
      401
    );
    const acknowledgedSequences = ipcMocks.acknowledgeOutput.mock.calls.map((call) => call[3]);
    expect(acknowledgedSequences).toEqual([400, 401]);
    writeSpy.mockRestore();
  });

  it('uses Unicode11 cell widths for CJK and a modern emoji', async () => {
    pty = new FrontendPty('unicode-session');
    pty.flushPendingWrites();
    await new Promise<void>((resolve) => pty?.terminal.write('A中🧪B', resolve));

    expect(pty.terminal.unicode.activeVersion).toBe('11');
    const line = pty.terminal.buffer.active.getLine(0);
    expect(line?.translateToString(true)).toBe('A中🧪B');
    expect(line?.getCell(0)?.getWidth()).toBe(1);
    expect(line?.getCell(1)?.getWidth()).toBe(2);
    expect(line?.getCell(2)?.getWidth()).toBe(0);
    expect(line?.getCell(3)?.getWidth()).toBe(2);
    expect(line?.getCell(4)?.getWidth()).toBe(0);
    expect(line?.getCell(5)?.getWidth()).toBe(1);
    expect(pty.terminal.buffer.active.cursorX).toBe(6);
  });

  it('preserves bare LF cursor semantics for real PTY output', async () => {
    pty = new FrontendPty('line-feed-session');

    await new Promise<void>((resolve) => pty?.terminal.write('AB\nX', resolve));

    const buffer = pty.terminal.buffer.active;
    expect(buffer.getLine(0)?.translateToString(true)).toBe('AB');
    expect(buffer.getLine(1)?.translateToString(true)).toBe('  X');
    expect(buffer.cursorX).toBe(3);
    expect(buffer.cursorY).toBe(1);
  });

  it('uses one consumer token and unsubscribes it exactly once on repeated dispose', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('consumer-session');

    mountAndOpenFlushGate(pty);
    await pty.connect();
    const consumerId = ipcMocks.subscribe.mock.calls[0]?.[1];
    expect(consumerId).toEqual(expect.any(String));

    pty.dispose();
    pty.dispose();

    expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ipcMocks.unsubscribe).toHaveBeenCalledWith('consumer-session', consumerId);
  });
});
