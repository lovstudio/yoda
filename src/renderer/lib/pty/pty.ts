import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import {
  CODEX_INTERRUPTION_SCAN_TAIL_CHARS,
  isInterruptedCodexTerminalOutput,
} from '@shared/codex-terminal-interruption';
import {
  PTY_CONSUMER_HEARTBEAT_INTERVAL_MS,
  ptyDataChannel,
  type PtyDataEvent,
} from '@shared/events/ptyEvents';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
import { getCellMetrics } from './pty-dimensions';
import { registerOsc52ClipboardHandler } from './terminal-clipboard';
import { ensureXtermHost } from './xterm-host';

// ── Theme helpers ─────────────────────────────────────────────────────────────

export interface SessionTheme {
  override?: ITerminalOptions['theme'];
}

/**
 * xterm's renderers only fully support lineHeight 1.0. Any other value makes
 * each rendered row taller than the glyph cell, so on scroll the renderer
 * clears a vertically-misaligned region and the outgoing row's left cells
 * aren't erased before the incoming row paints — the left-gutter ghosting seen
 * during scroll. Keep this at 1.0; add row spacing via container CSS if needed,
 * never via xterm lineHeight.
 */
export const TERMINAL_LINE_HEIGHT = 1.0;

/**
 * Bound each xterm parser job. 64 Ki UTF-16 code units is at most 192 KiB of
 * UTF-8 for BMP text (and less for paired supplementary code points), while
 * still amortising Terminal.write overhead for normal PTY batches.
 */
export const XTERM_WRITE_CHUNK_CODE_UNITS = 64 * 1024;

type ConnectOutcome = 'connected' | 'cancelled';

type PendingConnectAttempt = {
  readonly consumerId: string;
  readonly pendingEvents: PtyDataEvent[];
  cancelled: boolean;
  snapshotResolved: boolean;
  unsubscribeRequested: boolean;
  stopListening: () => void;
};

type TerminalWriteQueueItem = {
  readonly data: string;
  readonly onWritten?: () => void;
  offset: number;
};

const RESET_TERMINAL_SEQUENCE = '\x1bc';

export const DEFAULT_TERMINAL_FONT_FAMILY = [
  'Menlo',
  'Monaco',
  'Consolas',
  '"Liberation Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Noto Sans Mono CJK TC"',
  '"Noto Sans Mono CJK JP"',
  '"PingFang SC"',
  '"Microsoft YaHei UI"',
  'monospace',
].join(', ');

export function buildTerminalFontFamily(fontFamily?: string): string {
  const trimmed = fontFamily?.trim();
  if (!trimmed) return DEFAULT_TERMINAL_FONT_FAMILY;
  return `${trimmed}, ${DEFAULT_TERMINAL_FONT_FAMILY}`;
}

export function readXtermCssVars(): ITerminalOptions['theme'] {
  return {
    background: cssVar('--xterm-bg'),
    foreground: cssVar('--xterm-fg'),
    cursor: cssVar('--xterm-cursor'),
    cursorAccent: cssVar('--xterm-cursor-accent'),
    selectionBackground: cssVar('--xterm-selection-bg'),
    selectionForeground: cssVar('--xterm-selection-fg'),
  };
}

export function buildTheme(theme?: SessionTheme): ITerminalOptions['theme'] {
  if (theme?.override) return { ...readXtermCssVars(), ...theme.override };
  return readXtermCssVars();
}

// ── FrontendPty ───────────────────────────────────────────────────────────────

/**
 * Frontend counterpart to the main-process Pty interface.
 *
 * Owns the xterm Terminal instance for the full lifetime of the session.
 * The terminal is created synchronously during construction and opened into
 * an off-screen container. After mount/measurement opens the flush gate,
 * connect() subscribes to the main-process ring buffer and live IPC events.
 * Successful subscriptions survive later unmounts so the main-process flow
 * control and sequence watermark stay intact. While off-screen, xterm parsing
 * is suspended; the bounded backend watermark naturally pauses noisy sessions
 * until the terminal is visible again. On remount, queued output is replayed as
 * one ordered frame so intermediate TUI cursor positions stay hidden.
 *
 * DOM management is handled via mount() / unmount():
 *  - mount()   → appends ownedContainer to the visible mount target
 *  - unmount() → moves ownedContainer back to the off-screen host
 *
 * Lifecycle: created and owned by PtySession (stores/pty-session.ts), one per
 * live session. Survives React component unmounts (e.g. navigating away from a
 * task), and is disposed only when the entity (terminal or conversation) is
 * explicitly deleted.
 */
export class FrontendPty {
  /** All live FrontendPty instances — used for app-wide operations (e.g. theme updates). */
  static readonly all = new Set<FrontendPty>();

  /**
   * Record the dimensions last sent to the backend for a session. Called by
   * every resize path (per-session and pane broadcast) so that a restart can
   * spawn the new PTY at the real pane size instead of the 80x24 fallback —
   * without this, a restarted tmux/TUI session is born at 24 rows and only
   * paints the top half of the pane.
   */
  /**
   * Record the dims sent to the backend PTY for this session. Returns true
   * when they DIFFER from the previously recorded dims — i.e. the rpc.pty
   * resize must actually be sent. Per-session (not per-pane) so a session
   * moving between panes (pin/unpin) is never deduped against a stale pane
   * broadcast.
   */
  static noteResize(sessionId: string, cols: number, rows: number): boolean {
    for (const pty of FrontendPty.all) {
      if (pty.sessionId === sessionId) {
        const changed = pty.lastSentDims?.cols !== cols || pty.lastSentDims?.rows !== rows;
        pty.lastSentDims = { cols, rows };
        return changed;
      }
    }
    // Unknown session — never skip the resize.
    return true;
  }
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private offData: (() => void) | null = null;
  private connectedConsumerId: string | null = null;
  private pendingConnectAttempt: PendingConnectAttempt | null = null;
  private connectPromise: Promise<ConnectOutcome> | null = null;
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;
  /**
   * Buffered output (historical + any live data) held while the terminal is
   * still off-screen at the constructor default cols/rows. Flushed on first
   * mount() after the terminal has been resized to real pane dimensions, so
   * scrollback never reflows from a stale default width.
   */
  private pendingWrites: Array<{
    data: string;
    acknowledgement?: { generation: number; sequence: number };
  }> = [];
  /** PTY batches received while this terminal is off-screen. */
  private suspendedWrites: Array<{
    data: string;
    acknowledgement?: { generation: number; sequence: number };
  }> = [];
  private hasFlushed = false;
  private terminalWriteQueue: TerminalWriteQueueItem[] = [];
  private terminalWriteActive = false;
  /** Prevent hidden sessions from spending renderer time parsing every batch. */
  private renderingSuspended = false;
  /** Token protecting a newer mount from an older replay completion callback. */
  private replayToken = 0;
  private outputGeneration = 0;
  private lastOutputSequence = 0;
  private acknowledgedGeneration = 0;
  private acknowledgedSequence = 0;
  /** Tail used to recognize a Codex interruption marker split across IPC batches. */
  private interruptionOutputTail = '';
  /** At most one history refresh is attempted for each backend generation. */
  private interruptionReplayGeneration = 0;
  /** Ignore stale repaint batches after an authoritative history replay. */
  private interruptedHistoryGeneration = 0;
  private interruptionReplayPromise: Promise<void> | null = null;
  private interruptionReplayEvents: PtyDataEvent[] = [];
  private consumerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private consumerHeartbeatInFlight = false;
  private isDisposed = false;
  private savedViewportY: number | null = null;
  /**
   * Whether the viewport was pinned to the tail (following live output) when
   * last scrolled. Restored on mount(): a session that was following the
   * bottom returns to the bottom — not to a now-stale absolute line that
   * scrolled into history while the session was backgrounded.
   */
  private savedAtBottom = true;
  /** Fractional wheel-scroll carry, so pixel-mode trackpad deltas don't quantize harshly. */
  private wheelPartialScroll = 0;
  /** Overrides OSC 8 hyperlink activation while a pane hosts this terminal; null = system browser. */
  private linkOpener: ((url: string) => void) | null = null;
  private readonly scrollDisposable: { dispose(): void };
  private isMounted = false;
  /** Lease protecting a newer host from an older React effect's late cleanup. */
  private mountGeneration = 0;

  get mounted(): boolean {
    return this.isMounted;
  }

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme,
    options?: { scrollbackLines?: number }
  ) {
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });

    this.terminal = new Terminal({
      cols: 120,
      rows: 32,
      scrollback: normalizeTerminalScrollbackLines(
        options?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      ),
      // A real PTY's termios owns newline translation. Rewriting bare LF here
      // changes terminal control semantics and can corrupt cursor-based TUIs.
      convertEol: false,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: TERMINAL_LINE_HEIGHT,
      letterSpacing: 0,
      reflowCursorLine: true,
      rescaleOverlappingGlyphs: true,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      minimumContrastRatio: 4.5,
      scrollOnUserInput: false,
      linkHandler: {
        activate: (_event: MouseEvent, text: string) => {
          if (this.linkOpener) {
            this.linkOpener(text);
            return;
          }
          rpc.app.openExternal(text).catch((error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    // Match modern shell wcwidth tables. The xterm core defaults to Unicode 6,
    // which mismeasures newer CJK/emoji code points and makes following glyphs
    // overwrite the wrong cells. Grapheme clustering remains opt-in until its
    // experimental width rules are validated against local, tmux, and SSH.
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.unicode.activeVersion = '11';

    // OSC 52 → system clipboard (tmux copy-mode etc.). Disposed with the terminal.
    registerOsc52ClipboardHandler(this.terminal);

    this.terminal.open(this.ownedContainer);
    FrontendPty.all.add(this);
    this.attachWheelScrollPolicy();
    this.scrollDisposable = this.terminal.onScroll((viewportY) => {
      this.savedViewportY = viewportY;
      this.savedAtBottom = viewportY >= this.terminal.buffer.active.baseY;
    });

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Make the mouse wheel scroll our scrollback even when the running agent has
   * enabled mouse tracking.
   *
   * Agents like codex/claude run in the NORMAL buffer (a scrolling transcript)
   * but turn on SGR mouse tracking for click interactions. xterm then sets the
   * viewport's `handleMouseWheel: false` and forwards wheel events to the app —
   * which ignores them — so the wheel goes dead and only the scrollbar drags
   * history. Every mainstream terminal (iTerm2, VS Code, Terminal.app) keeps
   * the wheel scrolling local history for normal-buffer apps; do the same.
   *
   * In the alternate buffer a full-screen TUI legitimately owns the wheel, so
   * we don't interfere there.
   */
  private attachWheelScrollPolicy(): void {
    this.terminal.attachCustomWheelEventHandler((event) => {
      // Alternate buffer: full-screen TUI owns the wheel.
      if (this.terminal.buffer.active.type !== 'normal') return true;
      // Only vt200/drag/any report the wheel to the app — for those xterm
      // disables its own viewport wheel handler. For none/x10 the wheel is NOT
      // forwarded and xterm's viewport still scrolls the scrollback (with
      // smooth scrolling), so let it; intervening here would double-scroll.
      const mode = this.terminal.modes.mouseTrackingMode;
      if (mode === 'none' || mode === 'x10') return true;
      // App HAS wheel-reporting mouse tracking on: xterm would hand it the wheel. Scroll our
      // history locally instead, and swallow the event so it never reaches the
      // app.
      const cellHeight = getCellMetrics(this.terminal)?.height ?? 0;
      let lines: number;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        lines = event.deltaY;
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        lines = event.deltaY * this.terminal.rows;
      } else {
        lines = event.deltaY / (cellHeight > 0 ? cellHeight : 16);
      }
      this.wheelPartialScroll += lines;
      const amount = Math.trunc(this.wheelPartialScroll);
      this.wheelPartialScroll -= amount;
      if (amount !== 0) this.terminal.scrollLines(amount);
      return false;
    });
  }

  /** Override OSC 8 hyperlink activation (e.g. in-app browser); null restores the system browser. */
  setLinkOpener(opener: ((url: string) => void) | null, mountLease?: number): void {
    if (mountLease !== undefined && mountLease !== this.mountGeneration) return;
    this.linkOpener = opener;
  }

  private refreshAllRows(): void {
    try {
      this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
    } catch {}
  }

  /**
   * Repaint every visible row from xterm's canonical buffer. The stable DOM
   * renderer has no retained GPU frame or shared glyph atlas, so this is a
   * deterministic model-to-view refresh.
   */
  private redrawViewportFromBuffer(): void {
    this.refreshAllRows();
  }

  setScrollbackLines(scrollbackLines: unknown): void {
    this.terminal.options.scrollback = normalizeTerminalScrollbackLines(scrollbackLines);
  }

  /**
   * Subscribe listener-first, then bridge the snapshot/live boundary with the
   * main process generation+sequence watermark. Listener-first alone can
   * duplicate a batch already present in the snapshot; snapshot-first can
   * lose a batch in the RPC return window. The watermark closes both races.
   *
   * The first subscription is allowed only after a visible mount has real
   * dimensions and opens the flush gate. Once established it remains live
   * across unmounts; only a still-pending first subscription is cancelled.
   */
  async connect(): Promise<void> {
    if (
      this.isDisposed ||
      this.connectedConsumerId !== null ||
      !this.isMounted ||
      !this.hasFlushed
    ) {
      return;
    }
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    const promise = this.connectOnce();
    this.connectPromise = promise;
    let outcome: ConnectOutcome;
    try {
      outcome = await promise;
    } finally {
      if (this.connectPromise === promise) this.connectPromise = null;
    }

    // A new host can claim the same FrontendPty while the cancelled RPC is
    // resolving. Retry for that live host; concurrent callers join this retry.
    if (
      outcome === 'cancelled' &&
      !this.isDisposed &&
      this.isMounted &&
      this.connectedConsumerId === null
    ) {
      await this.connect();
    }
  }

  private async connectOnce(): Promise<ConnectOutcome> {
    const pendingEvents: PtyDataEvent[] = [];
    let listenerActive = true;
    let attempt: PendingConnectAttempt | null = null;
    const offData = events.on(
      ptyDataChannel,
      (event) => {
        if (!attempt || attempt.cancelled) return;
        if (!attempt.snapshotResolved) {
          pendingEvents.push(event);
          return;
        }
        this.acceptOutputEvent(event);
      },
      this.sessionId
    );
    const stopListening = () => {
      if (!listenerActive) return;
      listenerActive = false;
      offData();
    };
    attempt = {
      consumerId: globalThis.crypto.randomUUID(),
      pendingEvents,
      cancelled: false,
      snapshotResolved: false,
      unsubscribeRequested: false,
      stopListening,
    };
    this.pendingConnectAttempt = attempt;

    let result: Awaited<ReturnType<typeof rpc.pty.subscribe>>;
    try {
      result = await rpc.pty.subscribe(this.sessionId, attempt.consumerId);
    } catch (error) {
      this.cancelConnectAttempt(attempt);
      throw error;
    }

    if (attempt.cancelled || this.isDisposed) {
      this.cancelConnectAttempt(attempt);
      return 'cancelled';
    }
    if (this.pendingConnectAttempt === attempt) this.pendingConnectAttempt = null;
    this.connectedConsumerId = attempt.consumerId;
    this.offData = attempt.stopListening;

    const snapshot = result.data;
    this.outputGeneration = snapshot.generation;
    this.lastOutputSequence = snapshot.sequence;
    this.acknowledgedGeneration = snapshot.generation;
    this.acknowledgedSequence = 0;
    this.interruptedHistoryGeneration = snapshot.replayedFromHistory ? snapshot.generation : 0;
    this.interruptionOutputTail = (snapshot.interruptionOutputTail ?? snapshot.buffer).slice(
      -CODEX_INTERRUPTION_SCAN_TAIL_CHARS
    );
    this.startConsumerHeartbeat();
    if (snapshot.buffer) {
      this.writeOrBuffer(snapshot.buffer, {
        generation: snapshot.generation,
        sequence: snapshot.sequence,
      });
    } else if (snapshot.sequence > 0) {
      this.acknowledgeOutput(snapshot.generation, snapshot.sequence);
    }

    attempt.snapshotResolved = true;
    for (const event of pendingEvents) this.acceptOutputEvent(event);
    pendingEvents.length = 0;
    return 'connected';
  }

  private cancelPendingConnect(): void {
    const attempt = this.pendingConnectAttempt;
    if (!attempt) return;
    this.cancelConnectAttempt(attempt);
    // A remount may start a fresh attempt with a distinct consumer token while
    // the cancelled subscribe RPC finishes in the background.
    this.connectPromise = null;
  }

  private cancelConnectAttempt(attempt: PendingConnectAttempt): void {
    attempt.cancelled = true;
    attempt.pendingEvents.length = 0;
    attempt.stopListening();
    if (this.pendingConnectAttempt === attempt) this.pendingConnectAttempt = null;
    if (attempt.unsubscribeRequested) return;
    attempt.unsubscribeRequested = true;
    void rpc.pty.unsubscribe(this.sessionId, attempt.consumerId).catch(() => {});
  }

  private acceptOutputEvent(event: PtyDataEvent): void {
    if (this.interruptionReplayPromise) {
      this.interruptionReplayEvents.push(event);
      return;
    }
    if (event.generation < this.outputGeneration) return;
    if (event.generation === this.outputGeneration && event.sequence <= this.lastOutputSequence) {
      return;
    }

    const nextInterruptionTail = (
      event.generation === this.outputGeneration ? this.interruptionOutputTail : ''
    )
      .concat(event.data)
      .slice(-CODEX_INTERRUPTION_SCAN_TAIL_CHARS);
    this.interruptionOutputTail = nextInterruptionTail;
    const remainsInterrupted = isInterruptedCodexTerminalOutput(nextInterruptionTail);
    if (this.interruptedHistoryGeneration === event.generation) {
      if (remainsInterrupted) {
        this.lastOutputSequence = event.sequence;
        this.acknowledgeOutput(event.generation, event.sequence);
        return;
      }
      this.interruptedHistoryGeneration = 0;
    }
    if (event.generation > this.interruptionReplayGeneration && remainsInterrupted) {
      this.interruptionReplayGeneration = event.generation;
      this.interruptionReplayEvents.push(event);
      this.startInterruptedHistoryReplay();
      return;
    }

    if (event.generation > this.outputGeneration) {
      this.outputGeneration = event.generation;
      this.lastOutputSequence = 0;
      this.acknowledgedGeneration = event.generation;
      this.acknowledgedSequence = 0;
    }

    this.lastOutputSequence = event.sequence;
    this.writeOrBuffer(event.data, {
      generation: event.generation,
      sequence: event.sequence,
    });
  }

  /**
   * A resumed Codex process can publish its stale interruption screen after a
   * cold rollout snapshot has already rendered. Re-subscribe with the existing
   * consumer so the main process can atomically exchange that screen for the
   * current rollout and return a watermark covering every queued startup byte.
   */
  private startInterruptedHistoryReplay(): void {
    const consumerId = this.connectedConsumerId;
    if (!consumerId || this.interruptionReplayPromise || this.isDisposed) return;

    const replay = this.refreshInterruptedHistory(consumerId);
    this.interruptionReplayPromise = replay;
    void replay.finally(() => {
      if (this.interruptionReplayPromise !== replay) return;
      this.interruptionReplayPromise = null;
      const pendingEvents = this.interruptionReplayEvents;
      this.interruptionReplayEvents = [];
      for (const event of pendingEvents) this.acceptOutputEvent(event);
    });
  }

  private async refreshInterruptedHistory(consumerId: string): Promise<void> {
    const interruptionTailAtReplayStart = this.interruptionOutputTail;
    try {
      const result = await rpc.pty.subscribe(this.sessionId, consumerId);
      if (this.isDisposed || this.connectedConsumerId !== consumerId) return;

      const snapshot = result.data;
      this.outputGeneration = snapshot.generation;
      this.lastOutputSequence = snapshot.sequence;
      this.acknowledgedGeneration = snapshot.generation;
      this.acknowledgedSequence = 0;
      // The snapshot watermark can already include the event that triggered
      // this replay. Keep its marker for the queued-event drain below so the
      // next stale repaint remains suppressible after sequence deduplication.
      this.interruptionOutputTail = interruptionTailAtReplayStart;
      this.interruptedHistoryGeneration = snapshot.replayedFromHistory ? snapshot.generation : 0;

      // RIS is parsed in-order after any already queued stale bytes, clearing
      // their screen and scrollback before the authoritative history is drawn.
      this.writeOrBuffer(`${RESET_TERMINAL_SEQUENCE}${snapshot.buffer}`, {
        generation: snapshot.generation,
        sequence: snapshot.sequence,
      });
    } catch (error) {
      log.warn('FrontendPty: failed to replay interrupted Codex history', {
        sessionId: this.sessionId,
        error,
      });
    }
  }

  private writeOrBuffer(
    data: string,
    acknowledgement?: { generation: number; sequence: number }
  ): void {
    if (this.hasFlushed) {
      if (this.renderingSuspended) {
        this.suspendedWrites.push({ data, acknowledgement });
        return;
      }
      this.writeTerminalData(data, () => {
        if (acknowledgement) {
          this.acknowledgeOutput(acknowledgement.generation, acknowledgement.sequence);
        }
      });
    } else {
      this.pendingWrites.push({ data, acknowledgement });
    }
  }

  private writeTerminalData(data: string, onWritten?: () => void): void {
    if (this.isDisposed) return;
    this.terminalWriteQueue.push({ data, onWritten, offset: 0 });
    this.pumpTerminalWriteQueue();
  }

  private pumpTerminalWriteQueue(): void {
    if (this.isDisposed || this.renderingSuspended || this.terminalWriteActive) return;
    const write = this.terminalWriteQueue[0];
    if (!write) return;
    if (write.offset >= write.data.length) {
      this.terminalWriteQueue.shift();
      // Empty writes are used as ordered completion sentinels when an
      // off-screen replay must stay hidden until xterm has drained its parser.
      if (write.data.length === 0) {
        this.terminalWriteActive = true;
        this.terminal.write('', () => {
          if (this.isDisposed) return;
          this.terminalWriteActive = false;
          write.onWritten?.();
          this.pumpTerminalWriteQueue();
        });
      } else {
        write.onWritten?.();
        this.pumpTerminalWriteQueue();
      }
      return;
    }

    let end = Math.min(write.offset + XTERM_WRITE_CHUNK_CODE_UNITS, write.data.length);
    // Keep a surrogate pair in the same parser job.
    if (
      end < write.data.length &&
      end > write.offset &&
      write.data.charCodeAt(end - 1) >= 0xd800 &&
      write.data.charCodeAt(end - 1) <= 0xdbff &&
      write.data.charCodeAt(end) >= 0xdc00 &&
      write.data.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }

    this.terminalWriteActive = true;
    this.terminal.write(write.data.slice(write.offset, end), () => {
      if (this.isDisposed) return;
      this.terminalWriteActive = false;
      write.offset = end;
      if (write.offset >= write.data.length) {
        this.terminalWriteQueue.shift();
        write.onWritten?.();
      }
      this.pumpTerminalWriteQueue();
    });
  }

  private acknowledgeOutput(generation: number, sequence: number): void {
    const consumerId = this.connectedConsumerId;
    if (!consumerId || generation <= 0 || sequence <= 0 || this.isDisposed) return;
    if (
      generation > this.acknowledgedGeneration ||
      (generation === this.acknowledgedGeneration && sequence > this.acknowledgedSequence)
    ) {
      this.acknowledgedGeneration = generation;
      this.acknowledgedSequence = sequence;
    }
    rpc.pty.acknowledgeOutput(this.sessionId, consumerId, generation, sequence).catch(() => {});
  }

  private startConsumerHeartbeat(): void {
    if (this.consumerHeartbeatTimer !== null) return;
    this.consumerHeartbeatTimer = setInterval(() => {
      const consumerId = this.connectedConsumerId;
      if (!consumerId || this.isDisposed || this.consumerHeartbeatInFlight) return;
      this.consumerHeartbeatInFlight = true;
      rpc.pty
        .heartbeatConsumer(
          this.sessionId,
          consumerId,
          this.acknowledgedGeneration,
          this.acknowledgedSequence
        )
        .catch(() => {})
        .finally(() => {
          this.consumerHeartbeatInFlight = false;
        });
    }, PTY_CONSUMER_HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Resume an off-screen session as one ordered replay. Keeping the terminal
   * hidden until the sentinel write completes prevents a TUI's intermediate
   * cursor positions from flashing through while the backlog is parsed.
   */
  private flushSuspendedWrites(token: number): void {
    const writes = this.suspendedWrites;
    this.suspendedWrites = [];

    if (writes.length > 0) {
      const data = writes.map((write) => write.data).join('');
      this.writeTerminalData(data, () => {
        for (const write of writes) {
          if (write.acknowledgement) {
            this.acknowledgeOutput(
              write.acknowledgement.generation,
              write.acknowledgement.sequence
            );
          }
        }
      });
    }

    // A zero-length queue item acts as a completion sentinel even when an
    // earlier visible write was still active when the terminal was unmounted.
    this.writeTerminalData('', () => {
      if (token !== this.replayToken || !this.isMounted || this.renderingSuspended) return;
      this.ownedContainer.style.visibility = '';
      this.redrawViewportFromBuffer();
    });
  }

  /**
   * Commit rows and columns as one canonical grid transition. The DOM renderer
   * paints directly from xterm's buffer, so there is no retained GPU frame to
   * freeze, stretch, or reveal later. A full refresh makes the new grid the only
   * visible state in the next browser paint.
   */
  commitResize(cols: number, rows: number): void {
    if (this.terminal.cols === cols && this.terminal.rows === rows) return;
    this.terminal.resize(cols, rows);
    this.redrawViewportFromBuffer();
  }

  /**
   * Flush any output that was buffered while the terminal was off-screen at
   * default cols/rows. Called by usePty once the terminal has been resized to
   * real pane dimensions, so historical scrollback is wrapped at the correct
   * width. Idempotent — no-op after the first call.
   */
  flushPendingWrites(): void {
    if (this.hasFlushed) return;
    this.hasFlushed = true;
    if (this.pendingWrites.length === 0) return;
    const pendingWrites = this.pendingWrites;
    this.pendingWrites = [];
    for (const [index, write] of pendingWrites.entries()) {
      this.writeTerminalData(write.data, () => {
        if (write.acknowledgement) {
          this.acknowledgeOutput(write.acknowledgement.generation, write.acknowledgement.sequence);
        }
        if (index !== pendingWrites.length - 1) return;
        try {
          this.terminal.scrollToBottom();
          this.savedViewportY = this.terminal.buffer.active.viewportY;
          this.savedAtBottom = true;
          this.redrawViewportFromBuffer();
        } catch {}
      });
    }
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): number {
    const mountLease = ++this.mountGeneration;
    this.renderingSuspended = false;
    const hasReplayBacklog = this.suspendedWrites.length > 0 || this.terminalWriteQueue.length > 0;
    const replayToken = ++this.replayToken;
    if (hasReplayBacklog) {
      this.ownedContainer.style.visibility = 'hidden';
    }
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    this.isMounted = true;
    if (hasReplayBacklog) {
      this.flushSuspendedWrites(replayToken);
    }
    // Force a clean renderer repaint after reparenting in the DOM.
    const t = this.terminal;
    const savedViewportY = this.savedViewportY;
    const savedAtBottom = this.savedAtBottom;
    requestAnimationFrame(() => {
      if (mountLease !== this.mountGeneration) return;
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        // A session that was following the tail returns to the tail — output
        // may have streamed in while it was backgrounded, pushing the old
        // absolute line into history.
        if (savedAtBottom) {
          t.scrollToBottom();
        } else if (savedViewportY !== null) {
          t.scrollToLine(savedViewportY);
        }
        this.redrawViewportFromBuffer();
      } catch {}
    });
    return mountLease;
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   */
  unmount(mountLease?: number): void {
    if (mountLease !== undefined && mountLease !== this.mountGeneration) return;
    this.mountGeneration += 1;
    this.replayToken += 1;
    this.ownedContainer.style.visibility = '';
    this.renderingSuspended = true;
    this.isMounted = false;
    this.cancelPendingConnect();
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Unsubscribes from the main process, tears down the IPC data listener,
   * disposes the xterm Terminal, and removes the owned container from the DOM.
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cancelPendingConnect();
    this.connectPromise = null;
    if (this.consumerHeartbeatTimer !== null) {
      clearInterval(this.consumerHeartbeatTimer);
      this.consumerHeartbeatTimer = null;
    }
    this.mountGeneration += 1;
    FrontendPty.all.delete(this);
    this.isMounted = false;
    this.replayToken += 1;
    this.renderingSuspended = true;
    this.suspendedWrites = [];
    this.terminalWriteQueue = [];
    this.terminalWriteActive = false;
    this.offData?.();
    this.offData = null;
    const connectedConsumerId = this.connectedConsumerId;
    this.connectedConsumerId = null;
    this.scrollDisposable.dispose();
    if (connectedConsumerId) {
      void rpc.pty.unsubscribe(this.sessionId, connectedConsumerId).catch(() => {});
    }
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
  }
}

// ── App-wide helpers ──────────────────────────────────────────────────────────

/** Apply a theme to all live terminals. Called on app-level theme change. */
export function applyThemeToAll(theme?: SessionTheme): void {
  const xTermTheme = buildTheme(theme);
  for (const pty of FrontendPty.all) {
    pty.terminal.options.theme = xTermTheme;
  }
}

/**
 * Apply the canonical lineHeight to every live terminal. lineHeight is set at
 * construction, so terminals that survive an HMR module swap keep the old value
 * until reconstructed. Calling this on module eval pushes the corrected value
 * to all existing sessions so a render-option fix lands everywhere immediately,
 * without forcing a new session.
 */
export function applyLineHeightToAll(): void {
  for (const pty of FrontendPty.all) {
    pty.terminal.options.lineHeight = TERMINAL_LINE_HEIGHT;
  }
}

applyLineHeightToAll();

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}
