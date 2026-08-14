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
    checkpointAndUnsubscribe: vi.fn(
      (_sessionId: string, _consumerId: string, _checkpoint: unknown) =>
        Promise.resolve({ success: true, data: { saved: true } })
    ),
    claimGenerationReveal: vi.fn(),
    releaseGenerationReveal: vi.fn(),
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
      checkpointAndUnsubscribe: ipcMocks.checkpointAndUnsubscribe,
      claimGenerationReveal: ipcMocks.claimGenerationReveal,
      releaseGenerationReveal: ipcMocks.releaseGenerationReveal,
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
    ipcMocks.checkpointAndUnsubscribe.mockClear();
    ipcMocks.claimGenerationReveal.mockReset();
    ipcMocks.releaseGenerationReveal.mockReset();
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

  it('prepares a cold snapshot off-screen and resolves only after xterm drains it', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: 'COLD-FIRST-FRAME', generation: 1, sequence: 4 },
    });
    pty = new FrontendPty('cold-first-frame-session');
    const writes: Array<{ data: string; callback?: () => void }> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((data, callback) => {
      writes.push({
        data: typeof data === 'string' ? data : new TextDecoder().decode(data),
        callback,
      });
    });
    let prepared = false;

    const preparation = pty.prepareFirstFrame({ cols: 120, rows: 32 }).then((result) => {
      prepared = true;
      return result;
    });

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.data).toBe('COLD-FIRST-FRAME');
    expect(prepared).toBe(false);
    expect(pty.mounted).toBe(true);

    writes[0]?.callback?.();
    await expect(preparation).resolves.toBe(true);
    expect(pty.mounted).toBe(false);
    expect(pty.ownedContainer.parentElement?.dataset.terminalHost).toBe('true');
    expect(ipcMocks.unsubscribe).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('captures a bounded checkpoint with recent scrollback before cache eviction', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: `${'old history\r\n'.repeat(2_000)}CURRENT FRAME`,
        generation: 1,
        sequence: 8,
      },
    });
    pty = new FrontendPty('checkpoint-session');
    const lease = mountAndOpenFlushGate(pty);

    await pty.connect();
    await vi.waitFor(() => expect(ipcMocks.acknowledgeOutput).toHaveBeenCalled());
    pty.unmount(lease);
    await pty.disposeAndWait({ checkpoint: true });

    expect(ipcMocks.checkpointAndUnsubscribe).toHaveBeenCalledWith(
      'checkpoint-session',
      expect.any(String),
      expect.objectContaining({
        generation: 1,
        sequence: 8,
        cols: 120,
        rows: 32,
      })
    );
    const checkpoint = ipcMocks.checkpointAndUnsubscribe.mock.calls[0]?.[2] as {
      buffer: string;
      scrollbackLines: number;
    };
    expect(checkpoint.buffer).toContain('CURRENT FRAME');
    expect(checkpoint.buffer.match(/old history/g)?.length ?? 0).toBeGreaterThan(1_000);
    expect(checkpoint.buffer.length).toBeLessThan(1024 * 1024);
    expect(checkpoint.scrollbackLines).toBe(5_000);
    expect(ipcMocks.unsubscribe).not.toHaveBeenCalled();
  });

  it('drains an active parser tail before checkpointing a continuously writing session', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Live frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('checkpoint-active-parser-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await vi.waitFor(() => expect(ipcMocks.acknowledgeOutput).toHaveBeenCalled());
    pty.unmount(lease);

    const writes: Array<{ callback?: () => void }> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((_data, callback) => {
      writes.push({ callback });
    });
    ipcMocks.emitData(output(2, 'live tail still crossing the xterm parser'));
    expect(writes).toHaveLength(1);
    expect(pty.hasRecoverableSnapshot).toBe(true);

    const disposal = pty.disposeAndWait({ checkpoint: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ipcMocks.checkpointAndUnsubscribe).not.toHaveBeenCalled();

    writes[0]?.callback?.();
    await disposal;
    expect(ipcMocks.checkpointAndUnsubscribe).toHaveBeenCalledWith(
      'checkpoint-active-parser-session',
      expect.any(String),
      expect.objectContaining({ generation: 1, sequence: 2 })
    );
    writeSpy.mockRestore();
    pty = null;
  });

  it('never marks a checkpoint canonical in the middle of synchronized output', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Partial frame ─╮\r\n│ Still repainting │\r\n╰─ Not committed ──╯',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('checkpoint-open-sync-transaction-session');
    const lease = mountAndOpenFlushGate(pty);

    await pty.connect();
    await vi.waitFor(() => expect(ipcMocks.acknowledgeOutput).toHaveBeenCalled());
    pty.unmount(lease);
    await pty.disposeAndWait({ checkpoint: true });

    expect(ipcMocks.checkpointAndUnsubscribe).toHaveBeenCalledWith(
      'checkpoint-open-sync-transaction-session',
      expect.any(String),
      expect.objectContaining({ canonical: false })
    );
  });

  it('restores a compact checkpoint at its source grid before fitting the visible pane', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: '\x1bcCOMPACT CURRENT FRAME',
        generation: 1,
        sequence: 9,
        checkpointDimensions: { cols: 80, rows: 24 },
      },
    });
    pty = new FrontendPty('checkpoint-restore-session');
    mountAndOpenFlushGate(pty);

    await pty.connect();
    await vi.waitFor(() => expect(ipcMocks.acknowledgeOutput).toHaveBeenCalled());

    expect(pty.terminal.cols).toBe(120);
    expect(pty.terminal.rows).toBe(32);
    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true)).toContain(
      'COMPACT CURRENT FRAME'
    );
  });

  it('accepts a parsed compact checkpoint without an additional quiet-window delay', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: '\x1bc╭─ Saved session ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯',
        generation: 3,
        sequence: 19,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    pty = new FrontendPty('checkpoint-canonical-fast-path-session');

    const preparation = pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
      waitForCanonicalOutput: true,
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('compact checkpoint used the fallback quiet window')), 250);
    });

    await expect(Promise.race([preparation, timeout])).resolves.toBe(true);
  });

  it('requires a backend redraw before accepting a checkpoint from another grid', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: '\x1bc╭─ 80x24 frame ─╮\r\n│ Missing lower rows │\r\n╰─ Old grid ────────╯',
        generation: 1,
        sequence: 19,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 80, rows: 24 },
      },
    });
    pty = new FrontendPty('checkpoint-grid-mismatch-session');
    let prepared = false;
    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = result;
        return result;
      });

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(prepared).toBe(false);
    ipcMocks.emitData(
      output(
        20,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ 120x32 frame ─╮\r\n│ Complete redraw │\r\n╰─ New grid ────────╯\x1b[?25h\x1b[?2026l'
      )
    );

    await expect(preparation).resolves.toBe(true);
  });

  it('does not trust a checkpoint-sized intermediate frame without canonical provenance', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1bc\x1b[?2026hLoading workspace\r\nRestoring context\r\nPreparing terminal\x1b[?25h\x1b[?2026l',
        generation: 3,
        sequence: 20,
        checkpointCanonical: false,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    pty = new FrontendPty('checkpoint-intermediate-frame-session');
    let prepared = false;
    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = result;
        return result;
      });

    // Even after the legacy 700 ms quiet heuristic, an untrusted compact
    // checkpoint must remain staged until newer live terminal output arrives.
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(prepared).toBe(false);
    ipcMocks.emitData({
      ...output(
        21,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Final frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      ),
      generation: 3,
    });
    await expect(preparation).resolves.toBe(true);
  });

  it('keeps a cold visible snapshot hidden until the parser reaches its final tail', async () => {
    const subscription = deferred<{
      success: true;
      data: { buffer: string; generation: number; sequence: number };
    }>();
    ipcMocks.subscribe.mockReturnValue(subscription.promise);
    pty = new FrontendPty('cold-visible-snapshot-session');
    mountAndOpenFlushGate(pty);

    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    const connected = pty.connect();
    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());

    const snapshot = Array.from(
      { length: 80 },
      (_, index) => `snapshot line ${String(index + 1).padStart(2, '0')}`
    ).join('\r\n');
    subscription.resolve({
      success: true,
      data: { buffer: snapshot, generation: 1, sequence: 1 },
    });
    await connected;

    // connect() establishes the ordered stream, but the historical parser and
    // tail positioning still belong to the hidden first-frame transaction.
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await vi.waitFor(() => expect(pty?.ownedContainer.style.visibility).toBe(''), {
      timeout: 1_500,
    });
    expect(pty.terminal.buffer.active.viewportY).toBe(pty.terminal.buffer.active.baseY);
    expect(
      pty.terminal.buffer.active
        .getLine(pty.terminal.buffer.active.baseY + pty.terminal.rows - 1)
        ?.translateToString(true)
    ).toContain('snapshot line 80');
  });

  it('reveals the latest complete atomic frame within one second at 25 Hz', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('continuous-atomic-live-frame-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { allowAtomicLiveFrame: true });
    pty.flushPendingWrites();
    await pty.connect();

    let sequence = 0;
    const emitFrame = () => {
      sequence += 1;
      ipcMocks.emitData(
        output(
          sequence,
          `\x1b[?2026h\x1b[2J\x1b[H╭─ Working frame ${sequence} ─╮\r\n│ Streaming live output │\r\n╰─ Still working ────────╯\x1b[?25h\x1b[?2026l`
        )
      );
    };
    emitFrame();
    const interval = setInterval(emitFrame, 40);
    const startedAt = performance.now();
    try {
      await expect(pty.waitForVisibleFrame(() => true, 1_200)).resolves.toBe(true);
    } finally {
      clearInterval(interval);
    }

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(sequence).toBeGreaterThanOrEqual(1);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it.each([
    ['30 Hz with jitter', [24, 43, 31, 36]],
    ['60 Hz with jitter', [8, 24, 13, 19]],
    ['fixed 60 Hz', [16]],
  ])(
    'does not starve or revoke readiness under complete atomic frames at %s',
    async (_label, delays) => {
      ipcMocks.subscribe.mockResolvedValue({
        success: true,
        data: {
          buffer: 'STALE-HISTORY',
          generation: 0,
          sequence: 0,
          replayedFromHistory: true,
        },
      });
      pty = new FrontendPty(`high-frequency-atomic-${_label}`);
      mountTarget = document.createElement('div');
      document.body.appendChild(mountTarget);
      pty.mount(mountTarget, { cols: 120, rows: 32 }, { allowAtomicLiveFrame: true });
      pty.flushPendingWrites();
      await pty.connect();

      const frameStates: boolean[] = [];
      const unsubscribeFrameState = pty.subscribeVisibleFrameState((ready) => {
        frameStates.push(ready);
      });
      let sequence = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let running = true;
      const emitAndSchedule = () => {
        sequence += 1;
        ipcMocks.emitData(
          output(
            sequence,
            `\x1b[?2026h\x1b[2J\x1b[H╭─ Atomic frame ${sequence} ─╮\r\n│ Provider turn confirmed │\r\n╰─ Streaming safely ───────╯\x1b[?25h\x1b[?2026l`
          )
        );
        if (!running) return;
        timer = setTimeout(emitAndSchedule, delays[sequence % delays.length] ?? 16);
      };
      emitAndSchedule();
      const startedAt = performance.now();
      try {
        await expect(pty.waitForVisibleFrame(() => true, 1_000)).resolves.toBe(true);
        expect(performance.now() - startedAt).toBeLessThan(1_000);
        await new Promise((resolve) => setTimeout(resolve, 140));
      } finally {
        running = false;
        if (timer !== null) clearTimeout(timer);
        unsubscribeFrameState();
      }

      const firstReadyIndex = frameStates.indexOf(true);
      expect(firstReadyIndex).toBeGreaterThanOrEqual(0);
      expect(frameStates.slice(firstReadyIndex + 1)).not.toContain(false);
      expect(pty.ownedContainer.style.visibility).toBe('');
    }
  );

  it('keeps the 700 ms conservative policy when atomic live frames are not enabled', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('continuous-non-live-frame-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();

    let sequence = 0;
    const emitFrame = () => {
      sequence += 1;
      ipcMocks.emitData(
        output(
          sequence,
          `\x1b[?2026h\x1b[2J\x1b[H╭─ Unknown frame ${sequence} ─╮\r\n│ Runtime not confirmed │\r\n╰─ Keep staging ─────────╯\x1b[?25h\x1b[?2026l`
        )
      );
    };
    emitFrame();
    const interval = setInterval(emitFrame, 40);
    try {
      await expect(pty.waitForVisibleFrame(() => true, 450)).resolves.toBe(false);
    } finally {
      clearInterval(interval);
    }

    expect(sequence).toBeGreaterThanOrEqual(8);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
  });

  it('reveals a restored idle Codex frame from its transcript anchor under continuous 25 Hz redraws', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('continuous-transcript-anchor-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    pty.flushPendingWrites();
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, {
      kind: 'anchor',
      segments: ['Latest final assistant answer is now visible'],
    });

    let sequence = 0;
    const emitLoadingFrame = () => {
      sequence += 1;
      ipcMocks.emitData(
        output(
          sequence,
          `\x1b[?2026h\x1b[2J\x1b[HLoading frame ${sequence}\r\nRestoring conversation history\r\nPlease wait for the session\x1b[?25h\x1b[?2026l`
        )
      );
    };
    let resolved = false;
    const visible = pty
      .waitForVisibleFrame(() => true, 1_200)
      .then((ready) => {
        resolved = ready;
        return ready;
      });
    emitLoadingFrame();
    const loadingInterval = setInterval(emitLoadingFrame, 40);
    await new Promise((resolve) => setTimeout(resolve, 140));
    clearInterval(loadingInterval);
    expect(resolved).toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    const emitFinalFrame = () => {
      sequence += 1;
      ipcMocks.emitData(
        output(
          sequence,
          `\x1b[?2026h\x1b[2J\x1b[H╭─ Restored session ${sequence} ─╮\r\n│ Latest final assistant answer is now visible │\r\n╰─ Ready for input ─────────────────────────────╯\x1b[?25h\x1b[?2026l`
        )
      );
    };
    const startedAt = performance.now();
    emitFinalFrame();
    const finalInterval = setInterval(emitFinalFrame, 16);
    try {
      await expect(visible).resolves.toBe(true);
    } finally {
      clearInterval(finalInterval);
    }

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('reveals an unfinished live turn from a complete exact-generation DEC frame without a viewport text anchor', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('live-turn-surface-fence-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, { kind: 'live-turn' });

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Active Codex turn ─╮\r\n│ Current tool output │\r\n╰─ Still working ─────╯\x1b[?25h'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 250)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(output(2, '\x1b[?2026l'));
    await expect(pty.waitForVisibleFrame(() => true, 900)).resolves.toBe(true);
    expect(pty.canonicalGeneration).toBe(1);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('does not let a live-turn fence unlock a different backend generation', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('generation-bound-live-turn-fence-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(2, { kind: 'live-turn' });

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[HOld backend is complete\r\nBut its generation is stale\r\nDo not reveal it\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 250)).resolves.toBe(false);

    const replacement =
      '\x1b[?2026h\x1b[2J\x1b[HExact live backend\r\nCurrent turn is rendering\r\nSafe to reveal now\x1b[?25h\x1b[?2026l';
    ipcMocks.emitData({
      generation: 2,
      sequence: 1,
      data: replacement,
      byteLength: new TextEncoder().encode(replacement).byteLength,
    });
    await expect(pty.waitForVisibleFrame(() => true, 900)).resolves.toBe(true);
    expect(pty.canonicalGeneration).toBe(2);
  });

  it('requires a fresh transcript fence after the backend generation changes', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('generation-bound-transcript-anchor-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, {
      kind: 'anchor',
      segments: ['generation one final answer'],
    });

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[HGeneration one final answer\r\nReady for input\r\nComplete session\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 900)).resolves.toBe(true);

    ipcMocks.emitData({
      generation: 2,
      sequence: 0,
      byteLength: 0,
      data: '',
    });
    const replacementData =
      '\x1b[?2026h\x1b[2J\x1b[HGeneration one final answer\r\nReplacement still loading\r\nDo not reveal yet\x1b[?25h\x1b[?2026l';
    ipcMocks.emitData({
      generation: 2,
      sequence: 1,
      data: replacementData,
      byteLength: new TextEncoder().encode(replacementData).byteLength,
    });

    // Exceed the ordinary 700 ms quiet fallback: explicit transcript evidence
    // is generation-bound, so even matching text cannot let a replacement
    // inherit the preceding process's proof.
    await expect(pty.waitForVisibleFrame(() => true, 850)).resolves.toBe(false);
    expect(pty.canonicalGeneration).toBe(2);
    expect(pty.hasCanonicalSurfaceFence(2)).toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
  });

  it('does not satisfy a transcript anchor from normal-buffer scrollback', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('viewport-only-transcript-anchor-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 80, rows: 4 });
    pty.flushPendingWrites();
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, {
      kind: 'anchor',
      segments: ['old final assistant answer'],
    });

    ipcMocks.emitData(
      output(
        1,
        'Old final assistant answer\r\n' +
          Array.from({ length: 12 }, (_, index) => `scrollback filler ${index}\r\n`).join('')
      )
    );
    await vi.waitFor(() =>
      expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith(
        'viewport-only-transcript-anchor-session',
        expect.any(String),
        1,
        1
      )
    );
    expect(pty.terminal.buffer.active.baseY).toBeGreaterThan(0);

    ipcMocks.emitData(
      output(
        2,
        '\x1b[?2026h\x1b[2J\x1b[HLoading restored session\r\nReading history\r\nPlease wait\x1b[?25h\x1b[?2026l'
      )
    );
    // Exceed the ordinary 700 ms quiet fallback: the old matching line lives
    // only in scrollback and cannot release this quiet loading viewport.
    await expect(pty.waitForVisibleFrame(() => true, 850)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(
      output(
        3,
        '\x1b[?2026h\x1b[2J\x1b[HOld final assistant answer\r\nHistory restored\r\nReady for input\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 900)).resolves.toBe(true);
  });

  it('does not accept an anchored buffer until its cursor-ready DEC frame closes', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('open-transcript-anchor-frame-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, {
      kind: 'anchor',
      segments: ['wrapped final answer across the terminal'],
    });

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[HWrapped final answer across the terminal\r\nHistory is parsed\r\nFrame remains open\x1b[?25h'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 250)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(output(2, '\x1b[?2026l'));
    await expect(pty.waitForVisibleFrame(() => true, 900)).resolves.toBe(true);
  });

  it('reveals a quiet unverifiable-fence frame instead of re-verifying it forever', async () => {
    // Regression: an idle Codex resume whose transcript probe returned no text
    // evidence ("unverifiable") produced a quiet, cursor-complete frame that
    // waitForCanonicalOutput() accepted, but the visible ACK loop then read the
    // resulting prepared revision as "no atomic-live grace" and routed straight
    // back into the verifier — spinning until the slow-frame error surface
    // replaced a perfectly healthy terminal.
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('unverifiable-fence-quiet-frame-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.expectCanonicalSurfaceAnchor(1, { kind: 'unverifiable' });

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Restored idle session ─╮\r\n│ Ready for your input   │\r\n╰─ No provider evidence ─╯\x1b[?25h\x1b[?2026l'
      )
    );

    await expect(pty.waitForVisibleFrame(() => true, 3_000)).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('never treats an open synchronized transaction as an atomic live frame', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('open-atomic-live-frame-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { allowAtomicLiveFrame: true });
    pty.flushPendingWrites();
    await pty.connect();

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Partial frame ─╮\r\n│ Parser is still open │\r\n╰─ Do not reveal ──────╯\x1b[?25h'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 450)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(output(2, '\x1b[?2026l'));
    await expect(pty.waitForVisibleFrame(() => true, 1_000)).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('keeps atomic live readiness fenced to the expected generation', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation one ─╮\r\n│ Still the old process │\r\n╰─ Do not reveal ───────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('expected-atomic-live-generation-session');
    pty.expectCanonicalGeneration(2);
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { allowAtomicLiveFrame: true });
    pty.flushPendingWrites();
    await pty.connect();

    ipcMocks.emitData(
      output(
        2,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation one ─╮\r\n│ Working but obsolete │\r\n╰─ Do not reveal ──────╯\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(pty.waitForVisibleFrame(() => true, 450)).resolves.toBe(false);

    ipcMocks.emitData({
      ...output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation two ─╮\r\n│ Exact live process │\r\n╰─ Safe to reveal ───╯\x1b[?25h\x1b[?2026l'
      ),
      generation: 2,
    });
    await expect(pty.waitForVisibleFrame(() => true, 1_000)).resolves.toBe(true);
    expect(pty.canonicalGeneration).toBe(2);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('rejects a complete synchronized loading frame before the final cursor-ready TUI', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('cold-history-to-live-session');
    let prepared = false;

    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = true;
        return result;
      });

    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(prepared).toBe(false);

    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[HLoading agent…\r\nRestoring session…\r\nPlease wait…\x1b[?25h\x1b[?2026l'
      )
    );
    // The frame is structurally complete, has a visible cursor, and exceeds
    // the normal viewport-content threshold. That still only proves one atomic
    // redraw; Codex uses the same transaction for startup/loading screens.
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(prepared).toBe(false);

    ipcMocks.emitData(
      output(
        2,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Agent session ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(preparation).resolves.toBe(true);

    const rendered = Array.from({ length: pty.terminal.rows }, (_, index) =>
      pty?.terminal.buffer.active.getLine(index)?.translateToString(true)
    ).join('\n');
    expect(rendered).toContain('Ready for input');
    expect(rendered).not.toContain('STALE-HISTORY');
  });

  it('does not reuse a completed synchronized signal for a later banner revision', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('revision-bound-synchronized-frame-session');
    let prepared = false;
    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = true;
        return result;
      });

    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());
    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Initial frame ─╮\r\n│ Almost ready │\r\n╰─ Please wait ─╯\x1b[?25h\x1b[?2026l'
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 40));

    // This new revision has no synchronized transaction. It meets the viewport
    // size threshold, but must use the 700 ms fallback quiet window rather than
    // borrowing revision 1's strong 120 ms signal.
    ipcMocks.emitData(
      output(2, '\x1b[2J\x1b[HLoading workspace\r\nRestoring context\r\nPreparing terminal')
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(prepared).toBe(false);

    // A complete synchronized transaction without cursor-show is still a
    // fallback signal and must not get the strong 120 ms quiet window.
    ipcMocks.emitData(
      output(
        3,
        '\x1b[?2026h\x1b[2J\x1b[HLoading tools\r\nRestoring session\r\nPreparing prompt\x1b[?2026l'
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(prepared).toBe(false);

    ipcMocks.emitData(
      output(
        4,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Final frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(preparation).resolves.toBe(true);
  });

  it('recognizes synchronized output and cursor markers split across IPC batches', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('split-synchronized-markers-session');
    let prepared = false;
    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = result;
        return result;
      });

    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());
    ipcMocks.emitData(output(1, '\x1b[?20'));
    ipcMocks.emitData(
      output(
        2,
        '26h\x1b[2J\x1b[H╭─ Split frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?2'
      )
    );
    ipcMocks.emitData(output(3, '5h\x1b[?20'));
    ipcMocks.emitData(output(4, '26l'));

    await vi.waitFor(() => expect(prepared).toBe(true), { timeout: 900 });
    await expect(preparation).resolves.toBe(true);
  });

  it('serializes preparations so a cancelled staged mount cannot strand its successor', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'STALE-HISTORY',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });
    pty = new FrontendPty('serialized-first-frame-session');
    let keepFirstPreparation = true;

    const firstPreparation = pty.prepareFirstFrame(
      { cols: 120, rows: 32 },
      () => keepFirstPreparation,
      { waitForCanonicalOutput: true }
    );
    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());

    const secondPreparation = pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
      waitForCanonicalOutput: true,
    });
    keepFirstPreparation = false;

    await expect(firstPreparation).resolves.toBe(false);
    await vi.waitFor(() => expect(pty?.mounted).toBe(true));
    ipcMocks.emitData(
      output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ New request ─╮\r\n│ Ready to work │\r\n╰─ Idle ────────╯\x1b[?25h\x1b[?2026l'
      )
    );

    await expect(secondPreparation).resolves.toBe(true);
    expect(pty.mounted).toBe(false);
    expect(ipcMocks.subscribe).toHaveBeenCalledOnce();
  });

  it('waits for the expected generation instead of reusing a hot canonical frame', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h╭─ Old generation ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 4,
      },
    });
    pty = new FrontendPty('expected-generation-session');
    pty.expectCanonicalGeneration(2);
    let prepared = false;
    const preparation = pty
      .prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
      .then((result) => {
        prepared = true;
        return result;
      });

    await vi.waitFor(() => expect(ipcMocks.subscribe).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(prepared).toBe(false);

    ipcMocks.emitData({
      ...output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ New generation ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      ),
      generation: 2,
    });
    await expect(preparation).resolves.toBe(true);
  });

  it('promotes a stale expected generation to a newer subscription snapshot', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation two ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 2,
        sequence: 3,
      },
    });
    pty = new FrontendPty('snapshot-promotes-generation-session');
    pty.expectCanonicalGeneration(1);

    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
        timeoutMs: 1_000,
      })
    ).resolves.toBe(true);
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

  it('replaces a historical fallback before painting the first live generation', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'historical Working row\n',
        generation: 0,
        sequence: 0,
        replayedFromHistory: true,
      },
    });

    pty = new FrontendPty('history-to-live-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    ipcMocks.emitData(output(1, 'live Working row'));

    await vi.waitFor(() => {
      const rendered = Array.from({ length: pty?.terminal.rows ?? 0 }, (_, index) =>
        pty?.terminal.buffer.active.getLine(index)?.translateToString(true)
      ).join('\n');
      expect(rendered).toContain('live Working row');
      expect(rendered).not.toContain('historical Working row');
    });
  });

  it('keeps the live Codex TUI authoritative after an interruption screen', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer: 'Conversation interrupted - tell the model what to do differently.',
        generation: 1,
        sequence: 3,
      },
    });

    pty = new FrontendPty('live-interruption-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();

    ipcMocks.emitData(output(4, '\x1b[2J\x1b[HNORMAL-CODEX-TUI'));

    await vi.waitFor(() => {
      expect(pty?.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
        'NORMAL-CODEX-TUI'
      );
      expect(ipcMocks.subscribe).toHaveBeenCalledOnce();
      expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith(
        'live-interruption-session',
        expect.any(String),
        1,
        4
      );
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
    expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(2);
    expect(ipcMocks.unsubscribe).toHaveBeenLastCalledWith('cancel-pending-session', consumerId);

    pty.dispose();
    expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(2);
    pty = null;
  });

  it('times out one hung subscription attempt and cleans up a late consumer without retrying', async () => {
    const pendingSubscribe = deferred<{
      success: true;
      data: { buffer: string; generation: number; sequence: number };
    }>();
    ipcMocks.subscribe.mockReturnValue(pendingSubscribe.promise);
    const onConnectionError = vi.fn();
    pty = new FrontendPty('hung-subscription-session', undefined, { onConnectionError });
    mountAndOpenFlushGate(pty);

    vi.useFakeTimers();
    try {
      const connecting = pty.connect().then(
        () => null,
        (error: unknown) => error
      );
      expect(ipcMocks.subscribe).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_100);

      const error = await connecting;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('PTY output subscription timed out');
      expect(onConnectionError).toHaveBeenCalledOnce();
      expect(ipcMocks.subscribe).toHaveBeenCalledOnce();
      expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(1);
      expect(ipcMocks.listenerDisposals.at(-1)).toHaveBeenCalledOnce();

      pendingSubscribe.resolve({
        success: true,
        data: { buffer: 'TOO-LATE', generation: 1, sequence: 1 },
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(2);
      expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true) ?? '').toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a hot xterm synchronized while off-screen', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('offscreen-connected-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();

    pty.unmount(lease);
    ipcMocks.emitData(output(1, 'OFFSCREEN'));

    await vi.waitFor(() => {
      expect(pty?.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('OFFSCREEN');
      expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith(
        'offscreen-connected-session',
        expect.any(String),
        1,
        1
      );
    });
    expect(ipcMocks.unsubscribe).not.toHaveBeenCalled();

    const remountLease = pty.mount(mountTarget!, { cols: 120, rows: 32 });
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('OFFSCREEN');
    pty.unmount(remountLease);
  });

  it('reveals a previously painted live terminal as soon as its active parser write drains', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Live session ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('continuously-streaming-hot-session');
    const firstLease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(firstLease);

    const writes: Array<{ callback?: () => void }> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((_data, callback) => {
      writes.push({ callback });
    });
    ipcMocks.emitData(output(2, 'streaming output that has not reached the parser tail'));
    expect(writes).toHaveLength(1);
    expect(pty.canRevealImmediately).toBe(false);

    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    const remountLease = pty.mount(mountTarget, { cols: 120, rows: 32 });
    const visibleFrame = pty.waitForVisibleFrame();
    let visible = false;
    void visibleFrame.then((ready) => {
      visible = ready;
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(visible).toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    writes[0]?.callback?.();
    await expect(visibleFrame).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');

    writeSpy.mockRestore();
    pty.unmount(remountLease);
  });

  it('does not repaint-ack every output chunk after the visible frame is ready', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      ipcMocks.subscribe.mockResolvedValue({
        success: true,
        data: {
          buffer:
            '\x1b[?2026h\x1b[2J\x1b[H╭─ Live session ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
          generation: 1,
          sequence: 1,
        },
      });
      pty = new FrontendPty('visible-frame-ack-idempotency-session');
      mountAndOpenFlushGate(pty);
      await pty.connect();
      await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
      logSpy.mockClear();

      ipcMocks.emitData(output(2, 'streaming output'));
      await vi.waitFor(() => {
        expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledWith(
          'visible-frame-ack-idempotency-session',
          expect.any(String),
          1,
          2
        );
      });
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(
        logSpy.mock.calls.filter(([message]) =>
          String(message).includes('hot visible frame painted')
        )
      ).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('keeps a hot remount hidden while its off-screen parser queue drains', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: { buffer: '', generation: 1, sequence: 0 },
    });
    pty = new FrontendPty('suspended-frame-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();
    pty.unmount(lease);

    const frameParts = [
      '\u001b[2J\u001b[HWaiting for ',
      '\u001b[?25hbackground terminal',
      '\r\n└ pnpm test',
    ];
    const writes: Array<{ data: string; callback?: () => void }> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((data, callback) => {
      writes.push({
        data: typeof data === 'string' ? data : new TextDecoder().decode(data),
        callback,
      });
    });
    frameParts.forEach((data, index) => ipcMocks.emitData(output(index + 1, data)));
    expect(writes).toHaveLength(1);

    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });

    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.data).toBe(frameParts[0]);
    expect(ipcMocks.acknowledgeOutput).not.toHaveBeenCalled();

    for (let index = 0; index < frameParts.length; index += 1) {
      expect(writes[index]?.data).toBe(frameParts[index]);
      writes[index]?.callback?.();
      expect(pty.ownedContainer.style.visibility).toBe('hidden');
    }
    expect(ipcMocks.acknowledgeOutput).toHaveBeenCalledTimes(3);
    expect(ipcMocks.acknowledgeOutput.mock.calls.map((call) => call[3])).toEqual([1, 2, 3]);
    writeSpy.mockRestore();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('keeps the current terminal scene visible during resize', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Initial frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('resize-final-frame-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);

    pty.commitResize(96, 24);
    expect(pty.ownedContainer.style.visibility).toBe('');
    ipcMocks.emitData(
      output(2, '\x1b[?2026h\x1b[2J\x1b[HResizing workspace…\r\nReflowing transcript…')
    );
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(pty.ownedContainer.style.visibility).toBe('');

    ipcMocks.emitData(
      output(
        3,
        '\x1b[2J\x1b[H╭─ Resized frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ─────────╯\x1b[?25h\x1b[?2026l'
      )
    );
    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(pty.terminal.cols).toBe(96);
    expect(pty.terminal.rows).toBe(24);
  });

  it('hides an old process at generation start and recovers after a late canonical frame', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation one ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('generation-visibility-session');
    mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);

    const frameStates: boolean[] = [];
    const unsubscribeFrameState = pty.subscribeVisibleFrameState((ready) => {
      frameStates.push(ready);
    });

    // Main publishes this empty sentinel synchronously when it registers the
    // replacement PTY, before the replacement has emitted its first byte.
    ipcMocks.emitData({ generation: 2, sequence: 0, byteLength: 0, data: '' });
    // A late generation-bound resize result from G1 must not downgrade the
    // authoritative G2 sentinel and strand the next canonical wait.
    pty.expectCanonicalGeneration(1);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    expect(frameStates.at(-1)).toBe(false);

    // A timed-out browser paint wait must not expose the reset/empty terminal.
    await expect(pty.waitForVisibleFrame(() => true, 50)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData({
      generation: 2,
      sequence: 1,
      byteLength: 120,
      data: '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation two ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
    });
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(frameStates.at(-1)).toBe(true);
    expect(
      Array.from({ length: pty.terminal.rows }, (_, index) =>
        pty?.terminal.buffer.active.getLine(index)?.translateToString(true)
      ).join('\n')
    ).toContain('Generation two');

    unsubscribeFrameState();
  });

  it('never lets a hot paint ACK recommit an old generation after replacement starts', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Hot generation one ─╮\r\n│ Ready for input │\r\n╰─ Idle ────────────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('hot-generation-paint-race-session');
    const firstLease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(firstLease);

    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    const hotFrame = pty.waitForVisibleFrame(() => true, 300);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    ipcMocks.emitData({ generation: 2, sequence: 0, byteLength: 0, data: '' });

    await expect(hotFrame).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData({
      ...output(
        1,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Hot generation two ─╮\r\n│ Replacement is ready │\r\n╰─ Safe to reveal ─────╯\x1b[?25h\x1b[?2026l'
      ),
      generation: 2,
    });
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(pty.canonicalGeneration).toBe(2);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('reveals an unchanged prepared frame only after its DOM rows commit', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Prepared frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('unchanged-visible-frame-session');
    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
    ).resolves.toBe(true);

    const visibleFrame = pty.waitForVisibleFrame();
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });

    // The parser is current, but IntersectionObserver may have paused the DOM
    // renderer in the off-screen host. Never expose its previous row scene.
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await expect(visibleFrame).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('paints a claimed staging frame without starting the autonomous visible ACK', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Staged frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    ipcMocks.claimGenerationReveal.mockResolvedValue({
      success: true,
      data: { token: 'staging-claim', generation: 1, expiresAt: Date.now() + 6_000 },
    });
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('claimed-staging-paint-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { autoAcknowledgeFrame: false });
    pty.flushPendingWrites();
    await pty.connect();
    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
    ).resolves.toBe(true);

    const frameStates: boolean[] = [];
    const unsubscribe = pty.subscribeVisibleFrameState((ready) => frameStates.push(ready));
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(frameStates).toEqual([false]);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    await expect(
      pty.acquireCanonicalRevealClaim(() => true, 1_000, {
        requireMountedFramePaint: true,
      })
    ).resolves.toBe(true);
    expect(frameStates.at(-1)).toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
    expect(ipcMocks.releaseGenerationReveal).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('never acknowledges a claimed staging paint while the document is hidden', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Hidden frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    ipcMocks.claimGenerationReveal.mockResolvedValue({
      success: true,
      data: { token: 'hidden-claim', generation: 1, expiresAt: Date.now() + 6_000 },
    });
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('hidden-claimed-staging-paint-session');
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { autoAcknowledgeFrame: false });
    pty.flushPendingWrites();
    await pty.connect();
    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
    ).resolves.toBe(true);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await expect(
        pty.acquireCanonicalRevealClaim(() => true, 100, {
          requireMountedFramePaint: true,
        })
      ).resolves.toBe(false);
    } finally {
      visibility.mockRestore();
    }
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    expect(ipcMocks.releaseGenerationReveal).toHaveBeenCalledWith('hidden-claim');
  });

  it('does not occupy the ordinary ACK slot while hidden and retries on visibilitychange', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Hidden ordinary frame ─╮\r\n│ Ready after foreground │\r\n╰─ Awaiting paint ────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    let hidden = true;
    const visibility = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockImplementation(() => (hidden ? 'hidden' : 'visible'));
    try {
      pty = new FrontendPty('hidden-ordinary-visible-frame-session');
      mountTarget = document.createElement('div');
      document.body.appendChild(mountTarget);
      pty.mount(mountTarget, { cols: 120, rows: 32 });
      pty.flushPendingWrites();
      await pty.connect();

      const visibleFrame = pty.waitForVisibleFrame(() => true, 1_200);
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(pty.ownedContainer.style.visibility).toBe('hidden');

      const foregroundedAt = performance.now();
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      await expect(visibleFrame).resolves.toBe(true);
      expect(performance.now() - foregroundedAt).toBeLessThan(500);
      expect(pty.ownedContainer.style.visibility).toBe('');
    } finally {
      visibility.mockRestore();
    }
  });

  it('rehides a prepared mount when output arrives during its render and paint ACK', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Prepared frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('visible-frame-paint-race-session');
    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
    ).resolves.toBe(true);

    let visibleFrameReady = false;
    const visibleFrame = pty.waitForVisibleFrame().then((ready) => {
      visibleFrameReady = true;
      return ready;
    });
    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 }, { allowAtomicLiveFrame: true });
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    // Let mount's first rAF enter the render/onRender/double-rAF ACK window.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(visibleFrameReady).toBe(false);
    ipcMocks.emitData(output(2, '\x1b[?2026h\x1b[2J\x1b[HLoading agent…\r\nPlease wait…\x1b[?25h'));

    // Hiding happens synchronously in noteOutputActivity, before xterm sees
    // the clear/loading bytes.
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await new Promise((resolve) => setTimeout(resolve, 160));
    expect(visibleFrameReady).toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(
      output(
        3,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Visible frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(visibleFrame).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('revalidates output received after preparation before acknowledging the visible frame', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Prepared frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    pty = new FrontendPty('visible-frame-revalidation-session');
    await expect(
      pty.prepareFirstFrame({ cols: 120, rows: 32 }, () => true, {
        waitForCanonicalOutput: true,
      })
    ).resolves.toBe(true);
    expect(pty.mounted).toBe(false);

    // This arrived off-screen after the prepared revision. The visible mount
    // must replay it, discover that the viewport is now blank, and stay hidden.
    ipcMocks.emitData(output(2, '\x1b[?2026h\x1b[2J\x1b[H   \r\n   \x1b[?2026l'));
    let visibleFrameReady = false;
    const visibleFrame = pty.waitForVisibleFrame().then((ready) => {
      visibleFrameReady = true;
      return ready;
    });

    mountTarget = document.createElement('div');
    document.body.appendChild(mountTarget);
    pty.mount(mountTarget, { cols: 120, rows: 32 });
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(visibleFrameReady).toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    ipcMocks.emitData(
      output(
        3,
        '\x1b[?2026h\x1b[2J\x1b[H╭─ Visible frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l'
      )
    );
    await expect(visibleFrame).resolves.toBe(true);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });

  it('chunks a 25 MiB snapshot without revealing or advancing ACKs early', async () => {
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
    expect(pty.ownedContainer.style.visibility).toBe('hidden');
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
      if (snapshotChunks.length === 1) {
        // A partial terminal protocol stream is never a valid frame. Keep the
        // xterm hidden until the full parser queue and visible-frame ACK settle.
        expect(pty.ownedContainer.style.visibility).toBe('hidden');
        expect(ipcMocks.acknowledgeOutput).not.toHaveBeenCalled();
      }
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

    const firstDispose = pty.disposeAndWait();
    const repeatedDispose = pty.disposeAndWait();
    expect(repeatedDispose).toBe(firstDispose);
    await firstDispose;

    expect(ipcMocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ipcMocks.unsubscribe).toHaveBeenCalledWith('consumer-session', consumerId);
  });

  it('holds an exact-generation reveal claim until visible-frame acknowledgement', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Claimed frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ─────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    ipcMocks.claimGenerationReveal.mockResolvedValue({
      success: true,
      data: { token: 'claim-1', generation: 1, expiresAt: Date.now() + 6_000 },
    });
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('generation-claim-session');
    const firstLease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(firstLease);

    await expect(pty.acquireCanonicalRevealClaim()).resolves.toBe(true);
    const consumerId = ipcMocks.subscribe.mock.calls[0]?.[1];
    expect(ipcMocks.claimGenerationReveal).toHaveBeenCalledWith(
      'generation-claim-session',
      consumerId,
      1
    );
    expect(ipcMocks.releaseGenerationReveal).not.toHaveBeenCalled();

    mountAndOpenFlushGate(pty);
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    // xterm's paint alone does not release. ConversationSession releases after
    // React has consumed the visible-frame=true state.
    expect(ipcMocks.releaseGenerationReveal).not.toHaveBeenCalled();

    pty.releaseCanonicalRevealClaim();
    expect(ipcMocks.releaseGenerationReveal).toHaveBeenCalledWith('claim-1');
  });

  it('keeps an exact-generation claim when the same PTY streams during acquisition', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Streaming frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
      },
    });
    const claimResult = deferred<{
      success: true;
      data: { token: string; generation: number; expiresAt: number };
    }>();
    ipcMocks.claimGenerationReveal.mockReturnValueOnce(claimResult.promise);
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('generation-claim-streaming-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(lease);

    const claim = pty.acquireCanonicalRevealClaim();
    await vi.waitFor(() => expect(ipcMocks.claimGenerationReveal).toHaveBeenCalledOnce());
    const parserCallbacks: Array<() => void> = [];
    const writeSpy = vi.spyOn(pty.terminal, 'write').mockImplementation((_data, callback) => {
      if (callback) parserCallbacks.push(callback);
    });
    ipcMocks.emitData(output(2, 'same-generation streaming update'));
    claimResult.resolve({
      success: true,
      data: { token: 'claim-streaming', generation: 1, expiresAt: Date.now() + 6_000 },
    });

    await expect(claim).resolves.toBe(true);
    await expect(pty.acquireCanonicalRevealClaim()).resolves.toBe(true);
    expect(ipcMocks.claimGenerationReveal).toHaveBeenCalledOnce();
    expect(ipcMocks.releaseGenerationReveal).not.toHaveBeenCalled();

    parserCallbacks[0]?.();
    writeSpy.mockRestore();
    pty.releaseCanonicalRevealClaim();
  });

  it('releases a claimed old generation before accepting a replacement sentinel', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Generation one ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    ipcMocks.claimGenerationReveal.mockResolvedValue({
      success: true,
      data: { token: 'claim-old', generation: 1, expiresAt: Date.now() + 6_000 },
    });
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('generation-claim-replacement-session');
    const lease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(lease);
    await expect(pty.acquireCanonicalRevealClaim()).resolves.toBe(true);

    ipcMocks.emitData({ generation: 2, sequence: 0, byteLength: 0, data: '' });

    expect(ipcMocks.releaseGenerationReveal).toHaveBeenCalledWith('claim-old');
    expect(pty.canonicalGeneration).toBe(2);
  });

  it('never paints an expired claim and renews it before revealing the same generation', async () => {
    ipcMocks.subscribe.mockResolvedValue({
      success: true,
      data: {
        buffer:
          '\x1b[?2026h\x1b[2J\x1b[H╭─ Expiring frame ─╮\r\n│ Ready for input │\r\n╰─ Idle ──────────╯\x1b[?25h\x1b[?2026l',
        generation: 1,
        sequence: 1,
        checkpointCanonical: true,
        checkpointDimensions: { cols: 120, rows: 32 },
      },
    });
    ipcMocks.claimGenerationReveal
      .mockResolvedValueOnce({
        success: true,
        data: { token: 'claim-expiring', generation: 1, expiresAt: Date.now() + 1 },
      })
      .mockResolvedValueOnce({ success: false, error: { type: 'not_claimable' } })
      .mockResolvedValueOnce({
        success: true,
        data: { token: 'claim-renewed', generation: 1, expiresAt: Date.now() + 6_000 },
      });
    ipcMocks.releaseGenerationReveal.mockResolvedValue({
      success: true,
      data: { released: true },
    });
    pty = new FrontendPty('generation-claim-expiry-session');
    const firstLease = mountAndOpenFlushGate(pty);
    await pty.connect();
    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    pty.unmount(firstLease);

    await expect(pty.acquireCanonicalRevealClaim()).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ipcMocks.releaseGenerationReveal).toHaveBeenCalledWith('claim-expiring');

    mountAndOpenFlushGate(pty);
    await expect(pty.waitForVisibleFrame(() => true, 100)).resolves.toBe(false);
    expect(pty.ownedContainer.style.visibility).toBe('hidden');

    await expect(pty.waitForVisibleFrame()).resolves.toBe(true);
    expect(ipcMocks.claimGenerationReveal).toHaveBeenCalledTimes(3);
    expect(pty.ownedContainer.style.visibility).toBe('');
  });
});
