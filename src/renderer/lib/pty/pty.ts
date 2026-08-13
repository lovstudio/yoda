import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
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
const FIRST_FRAME_TIMEOUT_MS = 5_000;
const SYNCHRONIZED_FIRST_FRAME_QUIET_MS = 120;
const FALLBACK_FIRST_FRAME_QUIET_MS = 700;
const FIRST_FRAME_CANCELLATION_POLL_MS = 25;
const MIN_FIRST_FRAME_NON_EMPTY_LINES = 3;
const MIN_FIRST_FRAME_VISIBLE_CHARACTERS = 24;

/** DEC synchronized-output boundaries used by both Codex and Claude TUIs. */
const SYNCHRONIZED_OUTPUT_START = '\x1b[?2026h';
const SYNCHRONIZED_OUTPUT_END = '\x1b[?2026l';
const SYNCHRONIZED_OUTPUT_CURSOR_SHOW = '\x1b[?25h';
const SYNCHRONIZED_OUTPUT_SCAN_OVERLAP =
  Math.max(
    SYNCHRONIZED_OUTPUT_START.length,
    SYNCHRONIZED_OUTPUT_END.length,
    SYNCHRONIZED_OUTPUT_CURSOR_SHOW.length
  ) - 1;

/** Reset a stale transcript screen before the first live PTY generation paints. */
const RESET_TERMINAL_SEQUENCE = '\x1bc';

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
  onFirstChunkWritten?: () => void;
  offset: number;
};

type ViewportContent = {
  readonly signature: string;
  readonly nonEmptyLines: number;
  readonly visibleCharacters: number;
};

type OutputActivityOutcome = 'activity' | 'elapsed' | 'cancelled';

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
 * control and sequence watermark stay intact. While off-screen, xterm keeps
 * parsing into its canonical buffer; xterm's IntersectionObserver pauses the
 * DOM renderer because the shared host is outside the viewport. On remount,
 * the renderer refreshes once from the already-current buffer.
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
    onFirstChunkWritten?: () => void;
  }> = [];
  /** PTY batches received while parsing is explicitly suspended. */
  private suspendedWrites: Array<{
    data: string;
    acknowledgement?: { generation: number; sequence: number };
    onFirstChunkWritten?: () => void;
  }> = [];
  private hasFlushed = false;
  private terminalWriteQueue: TerminalWriteQueueItem[] = [];
  private terminalWriteActive = false;
  /** Resolves explicit first-frame waits if the owning session is disposed mid-parse. */
  private terminalWriteWaiters = new Set<() => void>();
  /** Monotonic accepted-output revision used to prove a parser drain stayed quiet. */
  private outputRevision = 0;
  /** Live output accepted while hidden since the adaptive-cache sampler last read it. */
  private hiddenOutputCodeUnits = 0;
  private outputActivityWaiters = new Set<() => void>();
  private canonicalStateGeneration = -1;
  private canonicalGenerationBaseline = '';
  private canonicalGenerationHasPayload = false;
  private expectedCanonicalGeneration: number | null = null;
  private preparedCanonicalGeneration: number | null = null;
  private preparedCanonicalRevision: number | null = null;
  private synchronizedOutputOpen = false;
  private synchronizedOutputCursorShown = false;
  private synchronizedOutputCompletedRevision: number | null = null;
  private synchronizedOutputCompletedWithCursorRevision: number | null = null;
  private synchronizedOutputScanTail = '';
  /** Serialize staged mounts so one cancelled preparation cannot strand its successor. */
  private prepareFirstFrameTail: Promise<void> = Promise.resolve();
  private terminalRenderRevision = 0;
  private terminalRenderWaiters = new Set<() => void>();
  /** True after the listener-first subscribe boundary has delivered its initial snapshot. */
  private hasResolvedInitialSnapshot = false;
  /** The initial snapshot bytes have fully crossed xterm's parser boundary. */
  private initialSnapshotParserDrained = false;
  /** Includes layout transitions that do not advance the backend output watermark. */
  private visualFrameRevision = 0;
  /** Keeps cold hydration and an explicitly suspended replay out of the visible scene. */
  private visibleFrameSettlementPending = false;
  /** Output revision at the start of the current hidden visual transaction. */
  private visibleFrameSettlementOutputRevision = 0;
  private visibleFrameMountGeneration = 0;
  private visibleFrameAckMountGenerationInFlight = 0;
  private visibleFrameWaiters = new Set<(ready: boolean) => void>();
  /** Explicit parser suspension; normal hot-cache unmounts continue parsing off-screen. */
  private renderingSuspended = false;
  /** Token protecting a newer mount from an older replay completion callback. */
  private replayToken = 0;
  private outputGeneration = 0;
  private lastOutputSequence = 0;
  /** A history fallback is replaced wholesale when its live PTY generation arrives. */
  private resetBeforeNextLiveGeneration = false;
  private acknowledgedGeneration = 0;
  private acknowledgedSequence = 0;
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
  private readonly renderDisposable: { dispose(): void };
  private isMounted = false;
  /** Lease protecting a newer host from an older React effect's late cleanup. */
  private mountGeneration = 0;
  private debugSubscriptionStartedAt: number | null = null;
  private debugSnapshotReceivedAt: number | null = null;
  private debugVisibleMount: {
    lease: number;
    startedAt: number;
  } | null = null;

  get mounted(): boolean {
    return this.isMounted;
  }

  /** A pressure eviction is safe only after main owns a snapshot/watermark for this consumer. */
  get hasRecoverableSnapshot(): boolean {
    return this.connectedConsumerId !== null && this.hasResolvedInitialSnapshot;
  }

  /** Read and reset hidden live-output work for the adaptive cache pressure sampler. */
  takeHiddenOutputCodeUnits(): number {
    const codeUnits = this.isMounted ? 0 : this.hiddenOutputCodeUnits;
    this.hiddenOutputCodeUnits = 0;
    return codeUnits;
  }

  constructor(
    readonly sessionId: string,
    theme?: SessionTheme,
    options?: { scrollbackLines?: number }
  ) {
    const terminalTheme = buildTheme(theme);
    this.ownedContainer = document.createElement('div');
    Object.assign(this.ownedContainer.style, {
      width: '100%',
      height: '100%',
    });
    this.syncRenderBackground(terminalTheme?.background);

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
      theme: terminalTheme,
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
    this.renderDisposable = this.terminal.onRender(() => {
      this.terminalRenderRevision += 1;
      for (const resolve of this.terminalRenderWaiters) resolve();
      this.terminalRenderWaiters.clear();
    });

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
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

  /**
   * Keep xterm's DOM row surface opaque with the exact session theme. Chromium
   * can retain pixels from a previous transparent row layer while the terminal
   * is first resized or rapidly rewritten; painting the canonical background
   * in the same layer makes removed glyphs deterministic without replaying or
   * remounting terminal content.
   */
  private syncRenderBackground(background: string | undefined): void {
    if (background) {
      this.ownedContainer.style.setProperty('--yoda-xterm-background', background);
      return;
    }
    this.ownedContainer.style.removeProperty('--yoda-xterm-background');
  }

  setTheme(theme?: SessionTheme): void {
    const terminalTheme = buildTheme(theme);
    this.syncRenderBackground(terminalTheme?.background);
    this.terminal.options.theme = terminalTheme;
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
   * The first subscription is allowed only after a visible or staged mount
   * has real dimensions and opens the flush gate. Once established it remains
   * live across unmounts; only a still-pending first subscription is cancelled.
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

  /**
   * Hydrate one terminal frame without exposing any of its intermediate states.
   *
   * An explicit task open uses the off-screen xterm host as a staging surface:
   * subscribe to the historical/live snapshot, drain xterm's asynchronous
   * parser, then return the terminal to its suspended host. The later visible
   * mount can therefore reparent an already-populated buffer in one commit.
   *
   * A lease keeps this cleanup from detaching a newer visible mount if another
   * route claims the same terminal while preparation is in flight.
   */
  async prepareFirstFrame(
    targetDims?: { cols: number; rows: number },
    shouldContinue: () => boolean = () => true,
    options: { waitForCanonicalOutput?: boolean; timeoutMs?: number } = {}
  ): Promise<boolean> {
    const previousPreparation = this.prepareFirstFrameTail;
    let releasePreparation = (): void => {};
    this.prepareFirstFrameTail = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });

    await previousPreparation;
    try {
      if (this.isDisposed || !shouldContinue()) return false;
      return await this.prepareFirstFrameOnce(targetDims, shouldContinue, options);
    } finally {
      releasePreparation();
    }
  }

  /**
   * Wait for this terminal's real routed host to expose a painted canonical frame.
   *
   * A preparation mount in the shared off-screen host never satisfies this ACK.
   * A visible mount must first drain its suspended replay sentinel, restore the
   * terminal's visibility, emit an xterm render event, and cross a browser paint.
   */
  waitForVisibleFrame(
    shouldContinue: () => boolean = () => true,
    timeoutMs: number = FIRST_FRAME_TIMEOUT_MS
  ): Promise<boolean> {
    if (this.isDisposed || !shouldContinue()) return Promise.resolve(false);
    if (this.isVisibleFrameReady()) return Promise.resolve(true);

    const boundedTimeoutMs = Math.max(0, timeoutMs);
    return new Promise((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        this.visibleFrameWaiters.delete(onFrameReady);
        resolve(ready && shouldContinue() && this.isVisibleFrameReady());
      };
      const onFrameReady = (ready: boolean) => finish(ready);

      this.visibleFrameWaiters.add(onFrameReady);
      pollTimer = setInterval(() => {
        if (this.isDisposed || !shouldContinue()) finish(false);
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      timeoutTimer = setTimeout(() => {
        this.revealVisibleMountWithoutAck(this.mountGeneration);
        finish(false);
      }, boundedTimeoutMs);
      if (this.isVisibleMountLease(this.mountGeneration)) {
        this.scheduleVisibleFrameAck(this.mountGeneration);
      }
      if (this.isVisibleFrameReady()) finish(true);
    });
  }

  /** Require the next canonical-frame wait to represent this backend generation or newer. */
  expectCanonicalGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) return;
    if (
      this.preparedCanonicalGeneration !== null &&
      generation > this.preparedCanonicalGeneration
    ) {
      this.preparedCanonicalGeneration = null;
      this.preparedCanonicalRevision = null;
    }
    this.expectedCanonicalGeneration = generation;
  }

  private async prepareFirstFrameOnce(
    targetDims: { cols: number; rows: number } | undefined,
    shouldContinue: () => boolean,
    options: { waitForCanonicalOutput?: boolean; timeoutMs?: number }
  ): Promise<boolean> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? FIRST_FRAME_TIMEOUT_MS);
    const deadline = performance.now() + timeoutMs;

    const finishPreparation = async (): Promise<boolean> => {
      const connected = await this.waitForPromiseWithin(this.connect(), shouldContinue, deadline);
      if (!connected) return false;
      if (this.isDisposed || !shouldContinue()) return false;
      if (options.waitForCanonicalOutput) {
        const canonicalOutputAvailable = await this.waitForCanonicalOutput(
          shouldContinue,
          deadline
        );
        if (!canonicalOutputAvailable || this.isDisposed || !shouldContinue()) return false;
      }
      const writesDrained = await this.waitForPromiseWithin(
        this.waitForTerminalWrites(),
        shouldContinue,
        deadline
      );
      if (!writesDrained) return false;
      return !this.isDisposed && shouldContinue();
    };

    // A terminal may already be visible in a pinned pane. Never steal its DOM;
    // simply wait for the currently ordered parser queue to reach a sentinel.
    if (this.isMounted) {
      this.flushPendingWrites();
      return finishPreparation();
    }

    const dimensions = targetDims ??
      this.lastSentDims ?? {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      };
    const mountLease = this.mount(ensureXtermHost(), dimensions);
    try {
      this.flushPendingWrites();
      return await finishPreparation();
    } finally {
      this.unmount(mountLease);
    }
  }

  private async connectOnce(): Promise<ConnectOutcome> {
    const subscriptionStartedAt = performance.now();
    this.debugSubscriptionStartedAt = subscriptionStartedAt;
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
    log.debug('[pty-renderer] subscription requested', {
      sessionId: this.sessionId,
      mounted: this.isMounted,
      flushGateOpen: this.hasFlushed,
    });
    console.log('[DEBUG][agent-session-load] snapshot requested:', {
      sessionId: this.sessionId,
      mounted: this.isMounted,
      flushGateOpen: this.hasFlushed,
    });

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
    const snapshotReceivedAt = performance.now();
    this.debugSnapshotReceivedAt = snapshotReceivedAt;
    this.beginCanonicalGeneration(snapshot.generation);
    this.lastOutputSequence = snapshot.sequence;
    this.resetBeforeNextLiveGeneration = snapshot.replayedFromHistory === true;
    this.acknowledgedGeneration = snapshot.generation;
    this.acknowledgedSequence = 0;
    log.debug('[pty-renderer] subscription snapshot', {
      sessionId: this.sessionId,
      generation: snapshot.generation,
      sequence: snapshot.sequence,
      snapshotCharacters: snapshot.buffer.length,
      replayedFromHistory: snapshot.replayedFromHistory === true,
      pendingLiveEventCount: pendingEvents.length,
    });
    console.log('[DEBUG][agent-session-load] snapshot received:', {
      sessionId: this.sessionId,
      elapsedMs: Math.round((snapshotReceivedAt - subscriptionStartedAt) * 10) / 10,
      generation: snapshot.generation,
      sequence: snapshot.sequence,
      snapshotCharacters: snapshot.buffer.length,
      replayedFromHistory: snapshot.replayedFromHistory === true,
      pendingLiveEventCount: pendingEvents.length,
    });
    this.startConsumerHeartbeat();
    if (snapshot.buffer) {
      const initialSnapshotMountLease = this.mountGeneration;
      this.noteOutputActivity();
      this.observeCanonicalPayload(snapshot.buffer, this.outputRevision);
      this.writeOrBuffer(
        snapshot.buffer,
        {
          generation: snapshot.generation,
          sequence: snapshot.sequence,
        },
        () => {
          this.initialSnapshotParserDrained = true;
          console.log('[DEBUG][agent-session-load] snapshot parser drained:', {
            sessionId: this.sessionId,
            snapshotCharacters: snapshot.buffer.length,
            parserMs: Math.round((performance.now() - snapshotReceivedAt) * 10) / 10,
            elapsedMs: Math.round((performance.now() - subscriptionStartedAt) * 10) / 10,
          });
          if (this.hasResolvedInitialSnapshot && this.isVisibleMountLease(this.mountGeneration)) {
            this.scheduleVisibleFrameAck(this.mountGeneration);
          }
        },
        snapshot.buffer.length > XTERM_WRITE_CHUNK_CODE_UNITS
          ? () => {
              this.revealInitialSnapshotProgress(
                initialSnapshotMountLease,
                snapshot.buffer.length,
                subscriptionStartedAt
              );
            }
          : undefined
      );
    } else if (snapshot.sequence > 0) {
      this.noteOutputActivity();
      this.acknowledgeOutput(snapshot.generation, snapshot.sequence);
      this.initialSnapshotParserDrained = true;
    } else {
      this.initialSnapshotParserDrained = true;
    }

    attempt.snapshotResolved = true;
    for (const event of pendingEvents) this.acceptOutputEvent(event);
    pendingEvents.length = 0;
    this.hasResolvedInitialSnapshot = true;
    if (this.initialSnapshotParserDrained && this.isVisibleMountLease(this.mountGeneration)) {
      this.scheduleVisibleFrameAck(this.mountGeneration);
    }
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
    if (event.generation < this.outputGeneration) {
      log.debug('[pty-renderer] dropped stale output generation', {
        sessionId: this.sessionId,
        eventGeneration: event.generation,
        currentGeneration: this.outputGeneration,
        sequence: event.sequence,
      });
      return;
    }
    const isNewGeneration = event.generation > this.outputGeneration;
    const shouldResetStaleHistory = isNewGeneration && this.resetBeforeNextLiveGeneration;
    if (event.generation > this.outputGeneration) {
      const previousGeneration = this.outputGeneration;
      this.beginCanonicalGeneration(event.generation);
      this.lastOutputSequence = 0;
      this.acknowledgedGeneration = event.generation;
      this.acknowledgedSequence = 0;
      this.resetBeforeNextLiveGeneration = false;
      log.debug('[pty-renderer] live generation changed', {
        sessionId: this.sessionId,
        previousGeneration,
        generation: event.generation,
        firstSequence: event.sequence,
        resetHistoricalScreen: shouldResetStaleHistory,
      });
    }
    if (event.sequence <= this.lastOutputSequence) return;

    this.lastOutputSequence = event.sequence;
    if (!this.isMounted) this.hiddenOutputCodeUnits += event.data.length;
    this.noteOutputActivity();
    if (shouldResetStaleHistory) this.writeTerminalData(RESET_TERMINAL_SEQUENCE);
    this.observeCanonicalPayload(event.data, this.outputRevision);
    this.writeOrBuffer(event.data, {
      generation: event.generation,
      sequence: event.sequence,
    });
  }

  private writeOrBuffer(
    data: string,
    acknowledgement?: { generation: number; sequence: number },
    onWritten?: () => void,
    onFirstChunkWritten?: () => void
  ): void {
    if (this.hasFlushed) {
      if (this.renderingSuspended) {
        this.suspendedWrites.push({ data, acknowledgement, onFirstChunkWritten });
        return;
      }
      this.writeTerminalData(
        data,
        () => {
          if (acknowledgement) {
            this.acknowledgeOutput(acknowledgement.generation, acknowledgement.sequence);
          }
          onWritten?.();
        },
        onFirstChunkWritten
      );
    } else {
      this.pendingWrites.push({ data, acknowledgement, onFirstChunkWritten });
    }
  }

  private writeTerminalData(
    data: string,
    onWritten?: () => void,
    onFirstChunkWritten?: () => void
  ): void {
    if (this.isDisposed) return;
    this.terminalWriteQueue.push({ data, onWritten, onFirstChunkWritten, offset: 0 });
    this.pumpTerminalWriteQueue();
  }

  /** Wait until every write queued before this call has finished in xterm. */
  private waitForTerminalWrites(): Promise<void> {
    if (this.isDisposed) return Promise.resolve();
    if (!this.terminalWriteActive && this.terminalWriteQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.terminalWriteWaiters.add(resolve);
      if (this.isDisposed) {
        this.terminalWriteWaiters.delete(resolve);
        resolve();
      }
    });
  }

  private resolveTerminalWriteWaitersIfIdle(): void {
    if (this.terminalWriteActive || this.terminalWriteQueue.length > 0) return;
    for (const resolve of this.terminalWriteWaiters) resolve();
    this.terminalWriteWaiters.clear();
  }

  private waitForPromiseWithin(
    promise: Promise<unknown>,
    shouldContinue: () => boolean,
    deadline: number
  ): Promise<boolean> {
    if (this.isDisposed || !shouldContinue() || performance.now() >= deadline) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const cleanup = () => {
        if (pollTimer !== null) clearInterval(pollTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      };
      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(completed && !this.isDisposed && shouldContinue());
      };

      pollTimer = setInterval(() => {
        if (this.isDisposed || !shouldContinue()) finish(false);
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      timeoutTimer = setTimeout(() => finish(false), Math.max(0, deadline - performance.now()));
      promise.then(
        () => finish(true),
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        }
      );
    });
  }

  private beginCanonicalGeneration(generation: number): void {
    this.outputGeneration = generation;
    if (this.canonicalStateGeneration === generation) return;
    this.canonicalStateGeneration = generation;
    this.canonicalGenerationBaseline = this.readViewportContent().signature;
    this.canonicalGenerationHasPayload = false;
    this.synchronizedOutputOpen = false;
    this.synchronizedOutputCursorShown = false;
    this.synchronizedOutputCompletedRevision = null;
    this.synchronizedOutputCompletedWithCursorRevision = null;
    this.synchronizedOutputScanTail = '';
  }

  private observeCanonicalPayload(data: string, revision: number): void {
    if (!data) return;
    this.canonicalGenerationHasPayload = true;
    const scan = this.synchronizedOutputScanTail + data;
    let offset = 0;
    while (offset < scan.length) {
      const startIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_START, offset);
      const endIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_END, offset);
      const cursorIndex = scan.indexOf(SYNCHRONIZED_OUTPUT_CURSOR_SHOW, offset);
      const nextIndex = Math.min(
        startIndex < 0 ? Number.POSITIVE_INFINITY : startIndex,
        endIndex < 0 ? Number.POSITIVE_INFINITY : endIndex,
        cursorIndex < 0 ? Number.POSITIVE_INFINITY : cursorIndex
      );
      if (!Number.isFinite(nextIndex)) break;
      if (nextIndex === startIndex) {
        this.synchronizedOutputOpen = true;
        this.synchronizedOutputCursorShown = false;
        offset = startIndex + SYNCHRONIZED_OUTPUT_START.length;
        continue;
      }
      if (nextIndex === cursorIndex) {
        if (this.synchronizedOutputOpen) this.synchronizedOutputCursorShown = true;
        offset = cursorIndex + SYNCHRONIZED_OUTPUT_CURSOR_SHOW.length;
        continue;
      }
      if (nextIndex === endIndex && this.synchronizedOutputOpen) {
        this.synchronizedOutputCompletedRevision = revision;
        this.synchronizedOutputCompletedWithCursorRevision = this.synchronizedOutputCursorShown
          ? revision
          : null;
        this.synchronizedOutputOpen = false;
        this.synchronizedOutputCursorShown = false;
      }
      offset = endIndex + SYNCHRONIZED_OUTPUT_END.length;
    }
    this.synchronizedOutputScanTail = scan.slice(-SYNCHRONIZED_OUTPUT_SCAN_OVERLAP);
  }

  private noteOutputActivity(): void {
    if (
      (this.preparedCanonicalRevision !== null || this.visibleFrameSettlementPending) &&
      this.isVisibleMountLease(this.mountGeneration) &&
      this.visibleFrameMountGeneration !== this.mountGeneration
    ) {
      // The prepared frame was exposed synchronously, but has not crossed its
      // render/paint ACK yet. Hide it before any newer bytes reach xterm so a
      // clear/loading transition cannot flash between the old and new frames.
      this.ownedContainer.style.visibility = 'hidden';
    }
    this.outputRevision += 1;
    this.visualFrameRevision += 1;
    this.visibleFrameMountGeneration = 0;
    for (const resolve of this.outputActivityWaiters) resolve();
    this.outputActivityWaiters.clear();
  }

  private readViewportContent(): ViewportContent {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    let nonEmptyLines = 0;
    let visibleCharacters = 0;
    for (let row = 0; row < this.terminal.rows; row += 1) {
      const line = buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '';
      const trimmed = line.trim();
      lines.push(line.trimEnd());
      if (!trimmed) continue;
      nonEmptyLines += 1;
      visibleCharacters += Array.from(trimmed).filter((character) => !/\s/u.test(character)).length;
    }
    return {
      signature: lines.join('\n'),
      nonEmptyLines,
      visibleCharacters,
    };
  }

  private hasCanonicalViewport(): boolean {
    if (
      this.resetBeforeNextLiveGeneration ||
      this.canonicalStateGeneration !== this.outputGeneration ||
      !this.canonicalGenerationHasPayload ||
      (this.expectedCanonicalGeneration !== null &&
        this.outputGeneration < this.expectedCanonicalGeneration)
    ) {
      return false;
    }
    const viewport = this.readViewportContent();
    return (
      viewport.nonEmptyLines >= MIN_FIRST_FRAME_NON_EMPTY_LINES &&
      viewport.visibleCharacters >= MIN_FIRST_FRAME_VISIBLE_CHARACTERS &&
      (this.synchronizedOutputCompletedRevision === this.outputRevision ||
        viewport.signature !== this.canonicalGenerationBaseline)
    );
  }

  /** Wait for output from the requested live generation rather than a transcript fallback. */
  private async waitForCanonicalOutput(
    shouldContinue: () => boolean,
    deadline: number
  ): Promise<boolean> {
    while (!this.isDisposed && shouldContinue() && performance.now() < deadline) {
      const revisionBeforeDrain = this.outputRevision;
      const parserDrained = await this.waitForPromiseWithin(
        this.waitForTerminalWrites(),
        shouldContinue,
        deadline
      );
      if (!parserDrained) return false;
      // Output accepted while the sentinel was in xterm's queue sits after it.
      if (revisionBeforeDrain !== this.outputRevision) continue;

      const generation = this.outputGeneration;
      const revision = this.outputRevision;
      if (
        this.preparedCanonicalGeneration === generation &&
        this.preparedCanonicalRevision === revision &&
        this.hasCanonicalViewport()
      ) {
        return true;
      }
      if (this.hasCanonicalViewport() && !this.synchronizedOutputOpen) {
        const quietMs =
          this.synchronizedOutputCompletedWithCursorRevision === revision
            ? SYNCHRONIZED_FIRST_FRAME_QUIET_MS
            : FALLBACK_FIRST_FRAME_QUIET_MS;
        const quietOutcome = await this.waitForOutputActivityOrDelay(
          revision,
          quietMs,
          shouldContinue,
          deadline
        );
        if (quietOutcome === 'cancelled') return false;
        if (quietOutcome === 'activity') continue;

        const finalRevisionBeforeDrain = this.outputRevision;
        const finalParserDrained = await this.waitForPromiseWithin(
          this.waitForTerminalWrites(),
          shouldContinue,
          deadline
        );
        if (!finalParserDrained) return false;
        if (
          finalRevisionBeforeDrain !== this.outputRevision ||
          generation !== this.outputGeneration ||
          revision !== this.outputRevision ||
          !this.hasCanonicalViewport()
        ) {
          continue;
        }
        this.preparedCanonicalGeneration = generation;
        this.preparedCanonicalRevision = revision;
        return true;
      }

      const activityOutcome = await this.waitForOutputActivityOrDelay(
        revision,
        Math.max(0, deadline - performance.now()),
        shouldContinue,
        deadline
      );
      if (activityOutcome !== 'activity') return false;
    }
    return false;
  }

  private waitForOutputActivityOrDelay(
    observedRevision: number,
    delayMs: number,
    shouldContinue: () => boolean,
    deadline: number
  ): Promise<OutputActivityOutcome> {
    if (this.outputRevision !== observedRevision) return Promise.resolve('activity');
    if (this.isDisposed || !shouldContinue() || performance.now() >= deadline) {
      return Promise.resolve('cancelled');
    }

    const remainingMs = Math.max(0, deadline - performance.now());
    const boundedDelayMs = Math.min(Math.max(0, delayMs), remainingMs);
    const reachesDeadline = delayMs > remainingMs;
    return new Promise((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let delayTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (outcome: OutputActivityOutcome) => {
        if (settled) return;
        settled = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (delayTimer !== null) clearTimeout(delayTimer);
        this.outputActivityWaiters.delete(onActivity);
        resolve(outcome);
      };
      const onActivity = () => finish('activity');

      this.outputActivityWaiters.add(onActivity);
      pollTimer = setInterval(() => {
        if (this.isDisposed || !shouldContinue()) finish('cancelled');
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      delayTimer = setTimeout(
        () => finish(reachesDeadline ? 'cancelled' : 'elapsed'),
        boundedDelayMs
      );
      if (this.outputRevision !== observedRevision) finish('activity');
    });
  }

  private waitForTerminalRenderAfter(
    observedRevision: number,
    shouldContinue: () => boolean,
    deadline: number
  ): Promise<boolean> {
    if (this.terminalRenderRevision > observedRevision) return Promise.resolve(true);
    if (this.isDisposed || !shouldContinue() || performance.now() >= deadline) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (rendered: boolean) => {
        if (settled) return;
        settled = true;
        if (pollTimer !== null) clearInterval(pollTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        this.terminalRenderWaiters.delete(onRender);
        resolve(rendered && !this.isDisposed && shouldContinue());
      };
      const onRender = () => finish(this.terminalRenderRevision > observedRevision);

      this.terminalRenderWaiters.add(onRender);
      pollTimer = setInterval(() => {
        if (this.isDisposed || !shouldContinue()) finish(false);
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      timeoutTimer = setTimeout(() => finish(false), Math.max(0, deadline - performance.now()));
      if (this.terminalRenderRevision > observedRevision) finish(true);
    });
  }

  private pumpTerminalWriteQueue(): void {
    if (this.isDisposed || this.renderingSuspended || this.terminalWriteActive) return;
    const write = this.terminalWriteQueue[0];
    if (!write) {
      this.resolveTerminalWriteWaitersIfIdle();
      return;
    }
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
      const onFirstChunkWritten = write.onFirstChunkWritten;
      write.onFirstChunkWritten = undefined;
      onFirstChunkWritten?.();
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

  private isVisibleMountLease(mountLease: number): boolean {
    return (
      !this.isDisposed &&
      this.isMounted &&
      mountLease === this.mountGeneration &&
      this.ownedContainer.parentElement !== null &&
      this.ownedContainer.parentElement !== ensureXtermHost()
    );
  }

  private isVisibleFrameReady(): boolean {
    return (
      this.visibleFrameMountGeneration === this.mountGeneration &&
      this.isVisibleMountLease(this.mountGeneration) &&
      this.ownedContainer.style.visibility !== 'hidden'
    );
  }

  private scheduleVisibleFrameAck(mountLease: number): void {
    if (
      !this.isVisibleMountLease(mountLease) ||
      this.visibleFrameAckMountGenerationInFlight === mountLease
    ) {
      return;
    }
    this.visibleFrameAckMountGenerationInFlight = mountLease;
    void this.completeVisibleFrameAck(mountLease).finally(() => {
      if (this.visibleFrameAckMountGenerationInFlight === mountLease) {
        this.visibleFrameAckMountGenerationInFlight = 0;
      }
    });
  }

  private async completeVisibleFrameAck(mountLease: number): Promise<void> {
    const isCurrentMount = () => this.isVisibleMountLease(mountLease);
    const deadline = performance.now() + FIRST_FRAME_TIMEOUT_MS;
    while (isCurrentMount() && performance.now() < deadline) {
      // A cold visible mount starts before listener-first subscription resolves.
      // Keep it hidden until the snapshot and any events crossing that boundary
      // have entered the same ordered parser queue.
      if (!this.hasResolvedInitialSnapshot) return;

      const preparedRevision = this.preparedCanonicalRevision;
      if (preparedRevision !== null && this.outputRevision !== preparedRevision) {
        // Output changed after off-screen preparation. Keep the routed terminal
        // hidden until the new generation/frame reaches canonical readiness too.
        this.ownedContainer.style.visibility = 'hidden';
        const canonical = await this.waitForCanonicalOutput(isCurrentMount, deadline);
        if (!canonical) break;
        continue;
      }

      const stableRevision = this.outputRevision;
      const stableVisualRevision = this.visualFrameRevision;
      const parserDrained = await this.waitForPromiseWithin(
        this.waitForTerminalWrites(),
        isCurrentMount,
        deadline
      );
      if (!parserDrained) break;
      if (
        stableRevision !== this.outputRevision ||
        stableVisualRevision !== this.visualFrameRevision
      ) {
        if (preparedRevision !== null) this.ownedContainer.style.visibility = 'hidden';
        continue;
      }

      if (this.visibleFrameSettlementPending) {
        const outputChangedDuringSettlement =
          this.outputRevision !== this.visibleFrameSettlementOutputRevision;
        const quietMs = outputChangedDuringSettlement
          ? this.synchronizedOutputCompletedWithCursorRevision === this.outputRevision
            ? SYNCHRONIZED_FIRST_FRAME_QUIET_MS
            : FALLBACK_FIRST_FRAME_QUIET_MS
          : SYNCHRONIZED_FIRST_FRAME_QUIET_MS;
        const settled = await this.waitForPromiseWithin(
          new Promise<void>((resolve) => setTimeout(resolve, quietMs)),
          isCurrentMount,
          deadline
        );
        if (!settled) break;
        if (
          stableRevision !== this.outputRevision ||
          stableVisualRevision !== this.visualFrameRevision
        ) {
          continue;
        }
        if (this.savedAtBottom) {
          this.terminal.scrollToBottom();
          this.savedViewportY = this.terminal.buffer.active.viewportY;
        }
      }

      const renderRevision = this.terminalRenderRevision;
      this.redrawViewportFromBuffer();
      const rendered = await this.waitForTerminalRenderAfter(
        renderRevision,
        isCurrentMount,
        deadline
      );
      if (!rendered) break;
      const rowsCommitted = await this.waitForPromiseWithin(
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        isCurrentMount,
        deadline
      );
      if (!rowsCommitted) break;
      if (
        stableRevision !== this.outputRevision ||
        stableVisualRevision !== this.visualFrameRevision
      ) {
        if (preparedRevision !== null || this.visibleFrameSettlementPending) {
          this.ownedContainer.style.visibility = 'hidden';
        }
        continue;
      }

      // The off-screen parser can be current while its DOM rows still contain
      // the last visible frame. Reveal only after refresh() has committed the
      // canonical rows; otherwise reparenting exposes those stale rows for one
      // paint and produces the apparent duplicated/ghost terminal content.
      this.ownedContainer.style.visibility = '';
      const painted = await this.waitForPromiseWithin(
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        isCurrentMount,
        deadline
      );
      if (!painted) break;
      if (
        stableRevision !== this.outputRevision ||
        stableVisualRevision !== this.visualFrameRevision
      ) {
        if (preparedRevision !== null || this.visibleFrameSettlementPending) {
          this.ownedContainer.style.visibility = 'hidden';
        }
        continue;
      }

      this.visibleFrameMountGeneration = mountLease;
      this.visibleFrameSettlementPending = false;
      this.preparedCanonicalGeneration = null;
      this.preparedCanonicalRevision = null;
      for (const resolve of this.visibleFrameWaiters) resolve(true);
      this.visibleFrameWaiters.clear();
      const visibleMount =
        this.debugVisibleMount?.lease === mountLease ? this.debugVisibleMount : null;
      console.log('[DEBUG][agent-session-load] visible frame painted:', {
        sessionId: this.sessionId,
        elapsedMs: visibleMount
          ? Math.round((performance.now() - visibleMount.startedAt) * 10) / 10
          : null,
        subscriptionElapsedMs:
          this.debugSubscriptionStartedAt === null
            ? null
            : Math.round((performance.now() - this.debugSubscriptionStartedAt) * 10) / 10,
        snapshotToPaintMs:
          this.debugSnapshotReceivedAt === null
            ? null
            : Math.round((performance.now() - this.debugSnapshotReceivedAt) * 10) / 10,
        usedFallback: false,
      });
      if (visibleMount) this.debugVisibleMount = null;
      return;
    }

    // A false ACK lets the route owner choose its explicit fallback. Restore
    // the DOM scene so that fallback cannot leave a permanently blank terminal.
    this.revealVisibleMountWithoutAck(mountLease);
  }

  private revealVisibleMountWithoutAck(mountLease: number): void {
    if (!this.isVisibleMountLease(mountLease)) return;
    this.visibleFrameSettlementPending = false;
    this.ownedContainer.style.visibility = '';
    this.redrawViewportFromBuffer();
    const visibleMount =
      this.debugVisibleMount?.lease === mountLease ? this.debugVisibleMount : null;
    console.log('[DEBUG][agent-session-load] visible frame fallback:', {
      sessionId: this.sessionId,
      elapsedMs: visibleMount
        ? Math.round((performance.now() - visibleMount.startedAt) * 10) / 10
        : null,
      hasResolvedInitialSnapshot: this.hasResolvedInitialSnapshot,
      initialSnapshotParserDrained: this.initialSnapshotParserDrained,
      queuedWriteCount: this.terminalWriteQueue.length,
      pendingWriteCount: this.pendingWrites.length,
    });
    if (visibleMount) this.debugVisibleMount = null;
  }

  /**
   * A newly-created xterm has no stale DOM scene to protect. For a multi-chunk
   * cold snapshot, reveal the first parsed chunk instead of presenting a blank
   * panel until the entire scrollback and a quiet window have drained. The
   * ordered parser queue and backend ACK still complete at the final chunk.
   */
  private revealInitialSnapshotProgress(
    mountLease: number,
    snapshotCharacters: number,
    subscriptionStartedAt: number
  ): void {
    if (!this.isVisibleMountLease(mountLease)) return;
    this.visibleFrameSettlementPending = false;
    this.ownedContainer.style.visibility = '';
    this.redrawViewportFromBuffer();
    const visibleMount =
      this.debugVisibleMount?.lease === mountLease ? this.debugVisibleMount : null;
    console.log('[DEBUG][agent-session-load] progressive snapshot painted:', {
      sessionId: this.sessionId,
      elapsedMs: visibleMount
        ? Math.round((performance.now() - visibleMount.startedAt) * 10) / 10
        : null,
      subscriptionElapsedMs: Math.round((performance.now() - subscriptionStartedAt) * 10) / 10,
      snapshotCharacters,
      parsedCharacters: Math.min(snapshotCharacters, XTERM_WRITE_CHUNK_CODE_UNITS),
    });
  }

  /**
   * Resume an off-screen session as one ordered replay. Keeping the terminal
   * hidden until the sentinel write completes prevents a TUI's intermediate
   * cursor positions from flashing through while the backlog is parsed.
   */
  private flushSuspendedWrites(token: number, mountLease: number, visibleMount: boolean): void {
    const writes = this.suspendedWrites;
    this.suspendedWrites = [];

    if (writes.length > 0) {
      const data = writes.map((write) => write.data).join('');
      this.writeTerminalData(
        data,
        () => {
          for (const write of writes) {
            if (write.acknowledgement) {
              this.acknowledgeOutput(
                write.acknowledgement.generation,
                write.acknowledgement.sequence
              );
            }
          }
        },
        writes.find((write) => write.onFirstChunkWritten)?.onFirstChunkWritten
      );
    }

    // A zero-length queue item acts as a completion sentinel even when an
    // earlier visible write was still active when the terminal was unmounted.
    this.writeTerminalData('', () => {
      if (token !== this.replayToken || !this.isMounted || this.renderingSuspended) return;
      if (visibleMount) {
        this.scheduleVisibleFrameAck(mountLease);
      } else {
        this.ownedContainer.style.visibility = '';
        this.redrawViewportFromBuffer();
      }
    });
  }

  /**
   * Commit rows and columns without turning a normal layout resize into a
   * first-frame transaction. Xterm owns the buffer reflow and renderer update
   * performed by resize(); hiding the scene, forcing a second full refresh and
   * waiting for a visible-frame ACK makes the surrounding conversation surface
   * appear to unmount/remount on every divider or window resize.
   */
  commitResize(cols: number, rows: number): void {
    if (this.terminal.cols === cols && this.terminal.rows === rows) return;
    this.terminal.resize(cols, rows);
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
      this.writeTerminalData(
        write.data,
        () => {
          if (write.acknowledgement) {
            this.acknowledgeOutput(
              write.acknowledgement.generation,
              write.acknowledgement.sequence
            );
          }
          if (index !== pendingWrites.length - 1) return;
          try {
            this.terminal.scrollToBottom();
            this.savedViewportY = this.terminal.buffer.active.viewportY;
            this.savedAtBottom = true;
            this.redrawViewportFromBuffer();
          } catch {}
        },
        write.onFirstChunkWritten
      );
    }
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): number {
    const mountLease = ++this.mountGeneration;
    const visibleMount = mountTarget !== ensureXtermHost();
    if (visibleMount) {
      this.debugVisibleMount = { lease: mountLease, startedAt: performance.now() };
      console.log('[DEBUG][agent-session-load] visible mount requested:', {
        sessionId: this.sessionId,
        mountLease,
        hasResolvedInitialSnapshot: this.hasResolvedInitialSnapshot,
        initialSnapshotParserDrained: this.initialSnapshotParserDrained,
        connected: this.connectedConsumerId !== null,
        suspendedWriteCount: this.suspendedWrites.length,
        pendingWriteCount: this.pendingWrites.length,
        queuedWriteCount: this.terminalWriteQueue.length,
      });
    }
    this.visibleFrameMountGeneration = 0;
    this.renderingSuspended = false;
    // A hot-cache terminal keeps its parser current while off-screen. An
    // already-running parser queue is therefore the canonical live frame, not
    // a cold replay that should hide the scene and wait for a quiet period.
    const hasReplayBacklog = this.suspendedWrites.length > 0;
    const waitsForInitialSnapshot = visibleMount && !this.hasResolvedInitialSnapshot;
    const holdPreparedFrameUntilAck =
      visibleMount &&
      this.preparedCanonicalRevision !== null &&
      this.preparedCanonicalRevision !== this.outputRevision;
    const replayToken = ++this.replayToken;
    const requiresSettlement =
      waitsForInitialSnapshot || hasReplayBacklog || holdPreparedFrameUntilAck;
    if (requiresSettlement) {
      if (!this.visibleFrameSettlementPending) {
        this.visibleFrameSettlementOutputRevision = this.outputRevision;
      }
      this.visibleFrameSettlementPending = true;
    }
    // Reparenting an off-screen xterm exposes its last rendered DOM rows before
    // the renderer refresh scheduled below runs. Always keep a visible mount
    // hidden until completeVisibleFrameAck observes the refreshed row commit.
    // Hot terminals take the direct path (no quiet-period settlement), so this
    // costs only the renderer's next frame and never replays terminal content.
    this.ownedContainer.style.visibility = visibleMount ? 'hidden' : '';
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    this.isMounted = true;
    if (hasReplayBacklog) {
      this.flushSuspendedWrites(replayToken, mountLease, visibleMount);
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
        if (visibleMount && !hasReplayBacklog) this.scheduleVisibleFrameAck(mountLease);
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
    this.visibleFrameSettlementPending = false;
    this.ownedContainer.style.visibility = '';
    // Keep cached terminals synchronized while they live in the off-screen
    // host. Xterm's IntersectionObserver pauses DOM rendering there. Otherwise
    // every task switch accumulates a replay, and a continuously
    // working agent can keep resetting the visible-frame quiet window until its
    // five-second fallback. Renderer eviction still disposes the subscription
    // and parser through PtySession's adaptive cache policy.
    this.renderingSuspended = false;
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
    for (const resolve of this.terminalWriteWaiters) resolve();
    this.terminalWriteWaiters.clear();
    for (const resolve of this.outputActivityWaiters) resolve();
    this.outputActivityWaiters.clear();
    for (const resolve of this.terminalRenderWaiters) resolve();
    this.terminalRenderWaiters.clear();
    for (const resolve of this.visibleFrameWaiters) resolve(false);
    this.visibleFrameWaiters.clear();
    this.visibleFrameMountGeneration = 0;
    this.offData?.();
    this.offData = null;
    const connectedConsumerId = this.connectedConsumerId;
    this.connectedConsumerId = null;
    this.scrollDisposable.dispose();
    this.renderDisposable.dispose();
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
  for (const pty of FrontendPty.all) {
    pty.setTheme(theme);
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
