import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type ITerminalOptions } from '@xterm/xterm';
import {
  PTY_CONSUMER_HEARTBEAT_INTERVAL_MS,
  ptyDataChannel,
  type PtyDataEvent,
} from '@shared/events/ptyEvents';
import {
  DEFAULT_TERMINAL_RENDERER,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalRenderer,
  normalizeTerminalScrollbackLines,
  type TerminalRenderer,
} from '@shared/terminal-settings';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { events, rpc } from '@renderer/lib/ipc';
import { cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
import { getCellMetrics } from './pty-dimensions';
import { registerOsc52ClipboardHandler } from './terminal-clipboard';
import {
  resolveTerminalRendererEngine,
  type TerminalRendererEngine,
} from './terminal-renderer-selection';
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
 * Sole timer in the resize pipeline's unfreeze chain: reveals the resized
 * terminal when no TUI repaint ever arrives (plain shells, silent sessions —
 * their rewrapped plain text is already the correct final content).
 * Everything else is event-driven; see FrontendPty.commitResize().
 */
const UNFREEZE_FALLBACK_MS = 300;
/** Avoid a full-canvas GPU→2D copy on every high-frequency cursor repaint. */
const FREEZE_SNAPSHOT_MIN_INTERVAL_MS = 150;
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

export type TerminalRendererIssue = 'webgl-unavailable' | 'webgl-context-lost';

type TerminalRendererDiagnosticsEntry = {
  preference: TerminalRenderer;
  engine: TerminalRendererEngine;
  issue: TerminalRendererIssue | null;
};

export type TerminalRendererDiagnostics = {
  activeCount: number;
  webglCount: number;
  domCount: number;
  fallbackCount: number;
  strictFailureCount: number;
  issueCounts: Record<TerminalRendererIssue, number>;
};

function createEmptyTerminalRendererDiagnostics(): TerminalRendererDiagnostics {
  return {
    activeCount: 0,
    webglCount: 0,
    domCount: 0,
    fallbackCount: 0,
    strictFailureCount: 0,
    issueCounts: {
      'webgl-unavailable': 0,
      'webgl-context-lost': 0,
    },
  };
}

let terminalRendererDiagnosticsSnapshot = createEmptyTerminalRendererDiagnostics();
const terminalRendererDiagnosticsListeners = new Set<() => void>();

function recomputeTerminalRendererDiagnostics(): TerminalRendererDiagnostics {
  const diagnostics = createEmptyTerminalRendererDiagnostics();
  diagnostics.activeCount = FrontendPty.all.size;

  for (const pty of FrontendPty.all) {
    const entry = pty.getRendererDiagnosticsEntry();
    if (entry.engine === 'webgl') diagnostics.webglCount += 1;
    if (entry.engine === 'dom') diagnostics.domCount += 1;
    if (!entry.issue) continue;

    diagnostics.issueCounts[entry.issue] += 1;
    if (entry.preference === 'webgl') {
      diagnostics.strictFailureCount += 1;
    } else {
      diagnostics.fallbackCount += 1;
    }
  }

  return diagnostics;
}

function notifyTerminalRendererDiagnosticsChanged(): void {
  terminalRendererDiagnosticsSnapshot = recomputeTerminalRendererDiagnostics();
  for (const listener of terminalRendererDiagnosticsListeners) {
    listener();
  }
}

export function getTerminalRendererDiagnostics(): TerminalRendererDiagnostics {
  return terminalRendererDiagnosticsSnapshot;
}

export function subscribeTerminalRendererDiagnostics(listener: () => void): () => void {
  terminalRendererDiagnosticsListeners.add(listener);
  return () => terminalRendererDiagnosticsListeners.delete(listener);
}

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
 * Successful subscriptions survive later unmounts so off-screen sessions keep
 * parsing and acknowledging output without retaining a GPU renderer.
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
  private static readonly reportedRendererFailures = new Set<string>();

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
  private hasFlushed = false;
  private terminalWriteQueue: TerminalWriteQueueItem[] = [];
  private terminalWriteActive = false;
  private outputGeneration = 0;
  private lastOutputSequence = 0;
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
  /** Snapshot overlay hiding resize transitions — see commitResize(). */
  private freezeOverlay: HTMLCanvasElement | null = null;
  /** Whether freezeOverlay holds a usable captured frame (see captureFreezeSnapshot). */
  private hasFreezeSnapshot = false;
  private lastFreezeSnapshotAt = Number.NEGATIVE_INFINITY;
  /** Per-render snapshot capture into freezeOverlay; disposed with the terminal. */
  private freezeSnapshotDisposable: IDisposable | null = null;
  /** Unfreeze event chain state: idle → await-data → await-render → idle. */
  private unfreezePhase: 'idle' | 'await-data' | 'await-render' = 'idle';
  private unfreezeRenderDisposable: IDisposable | null = null;
  private unfreezeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumps on each resize chain so stale rAF / timeout callbacks cannot unfreeze a newer frame. */
  private unfreezeGeneration = 0;
  /** Overrides OSC 8 hyperlink activation while a pane hosts this terminal; null = system browser. */
  private linkOpener: ((url: string) => void) | null = null;
  private readonly scrollDisposable: { dispose(): void };
  private rendererPreference: TerminalRenderer = DEFAULT_TERMINAL_RENDERER;
  private rendererEngine: TerminalRendererEngine = 'dom';
  private rendererIssue: TerminalRendererIssue | null = null;
  private webglAddon: WebglAddon | null = null;
  private webglContextLossDisposable: IDisposable | null = null;
  /** Off-screen sessions defer GPU recovery until mount(), avoiding background redraw work. */
  private isMounted = false;
  /** Lease protecting a newer host from an older React effect's late cleanup. */
  private mountGeneration = 0;

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
    notifyTerminalRendererDiagnosticsChanged();
    this.attachWheelScrollPolicy();
    this.scrollDisposable = this.terminal.onScroll((viewportY) => {
      this.savedViewportY = viewportY;
      this.savedAtBottom = viewportY >= this.terminal.buffer.active.baseY;
      this.invalidateFreezeSnapshot();
    });
    this.freezeSnapshotDisposable = this.terminal.onRender(() => this.captureFreezeSnapshot());

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

  getRendererDiagnosticsEntry(): TerminalRendererDiagnosticsEntry {
    return {
      preference: this.rendererPreference,
      engine: this.rendererEngine,
      issue: this.rendererIssue,
    };
  }

  setRendererPreference(renderer: unknown): void {
    const next = normalizeTerminalRenderer(renderer);
    const changed = this.rendererPreference !== next;
    this.rendererPreference = next;
    if (changed) notifyTerminalRendererDiagnosticsChanged();
    this.applyRendererPreference();
  }

  private applyRendererPreference(): void {
    const selectedEngine = resolveTerminalRendererEngine(this.rendererPreference);

    if (selectedEngine === 'dom') {
      this.disposeWebglRenderer();
      this.hasFreezeSnapshot = false;
      this.setRendererState('dom', null);
      this.refreshAllRows();
      return;
    }

    // Background sessions keep parsing into xterm's canonical buffer but do
    // not retain a GPU context. A WebGL renderer is created only for the
    // terminal that is actually mounted.
    if (!this.isMounted) {
      this.disposeWebglRenderer();
      this.setRendererState('dom', null);
      return;
    }

    if (this.webglAddon) {
      this.setRendererState('webgl', null);
      return;
    }

    this.loadWebglRenderer();
  }

  private setRendererState(
    engine: TerminalRendererEngine,
    issue: TerminalRendererIssue | null
  ): void {
    if (this.rendererEngine === engine && this.rendererIssue === issue) return;
    this.rendererEngine = engine;
    this.rendererIssue = issue;
    notifyTerminalRendererDiagnosticsChanged();
  }

  private disposeWebglRenderer(): void {
    this.invalidateFreezeSnapshot();
    this.webglContextLossDisposable?.dispose();
    this.webglContextLossDisposable = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
  }

  private refreshAllRows(): void {
    try {
      this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
    } catch {}
  }

  /**
   * A snapshot captured before the viewport moves no longer represents the
   * visible rows. Never let a later resize replay it over the current buffer.
   */
  private invalidateFreezeSnapshot(): void {
    this.hasFreezeSnapshot = false;
    if (this.unfreezePhase === 'idle' && this.freezeOverlay) {
      this.freezeOverlay.style.display = 'none';
    }
  }

  /**
   * Repaint visible rows from xterm's canonical buffer without clearing the
   * glyph atlas. xterm shares atlas pages across terminals; clearing one from a
   * scroll callback can leave sibling render models pointing at stale glyph
   * coordinates and is far more expensive than xterm's own dirty-row renderer.
   */
  private redrawViewportFromBuffer(): void {
    this.refreshAllRows();
  }

  private loadWebglRenderer(): void {
    let webglAddon: WebglAddon | null = null;
    let contextLossDisposable: IDisposable | null = null;

    try {
      // Default (preserveDrawingBuffer: false) — the drawing buffer is cleared
      // on every composite, so the renderer cannot accumulate stale text rows.
      // Resize freeze-frames replay snapshots captured during onRender instead
      // of reading the live canvas at resize time.
      webglAddon = new WebglAddon();
      contextLossDisposable = webglAddon.onContextLoss(() => {
        this.handleWebglRendererFailure('webgl-context-lost');
      });
      this.terminal.loadAddon(webglAddon);
      this.webglAddon = webglAddon;
      this.webglContextLossDisposable = contextLossDisposable;
      this.setRendererState('webgl', null);
      this.redrawViewportFromBuffer();
    } catch (error) {
      contextLossDisposable?.dispose();
      webglAddon?.dispose();
      this.handleWebglRendererFailure('webgl-unavailable', error);
    }
  }

  private handleWebglRendererFailure(issue: TerminalRendererIssue, error?: unknown): void {
    const strict = this.rendererPreference === 'webgl';
    log.warn(
      strict
        ? 'FrontendPty: WebGL renderer failed in strict mode; DOM emergency renderer active'
        : 'FrontendPty: WebGL renderer failed; using DOM compatibility renderer',
      {
        sessionId: this.sessionId,
        issue,
        error: error ? String(error) : undefined,
      }
    );

    this.disposeWebglRenderer();
    this.hasFreezeSnapshot = false;
    this.setRendererState('dom', issue);
    this.refreshAllRows();
    this.notifyRendererFailure(issue, error);
  }

  private notifyRendererFailure(issue: TerminalRendererIssue, error?: unknown): void {
    const strict = this.rendererPreference === 'webgl';
    const toastKey = `${strict ? 'strict' : 'auto'}:${issue}`;
    if (FrontendPty.reportedRendererFailures.has(toastKey)) return;
    FrontendPty.reportedRendererFailures.add(toastKey);

    const title = strict
      ? i18n.t('terminal.renderer.strictFailureTitle')
      : i18n.t('terminal.renderer.fallbackTitle');
    const descriptionKey = strict
      ? issue === 'webgl-context-lost'
        ? 'terminal.renderer.strictContextLostDescription'
        : 'terminal.renderer.strictUnavailableDescription'
      : issue === 'webgl-context-lost'
        ? 'terminal.renderer.fallbackContextLostDescription'
        : 'terminal.renderer.fallbackUnavailableDescription';

    toast({
      title,
      description: i18n.t(descriptionKey),
      variant: strict ? 'destructive' : undefined,
      debugInfo: {
        sessionId: this.sessionId,
        preference: this.rendererPreference,
        issue,
        error: error ? String(error) : undefined,
      },
    });
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
    if (event.generation < this.outputGeneration) return;
    if (event.generation > this.outputGeneration) {
      this.outputGeneration = event.generation;
      this.lastOutputSequence = 0;
      this.acknowledgedGeneration = event.generation;
      this.acknowledgedSequence = 0;
    }
    if (event.sequence <= this.lastOutputSequence) return;

    this.lastOutputSequence = event.sequence;
    this.writeOrBuffer(event.data, {
      generation: event.generation,
      sequence: event.sequence,
    });
  }

  /**
   * Does this chunk look like a TUI full-screen repaint rather than an
   * incremental update?  Incremental writes use positioned CUPs only
   * (`\x1b[35;1H…`), while a full repaint homes the cursor (bare `\x1b[H`),
   * clears the screen, or switches the alt buffer.  Deliberately NO size
   * heuristic: large chunks can be plain streamed output or OSC52 clipboard
   * payloads, and a false positive advances the unfreeze chain on stale
   * content.  Verified against live Claude Code traffic.
   */
  private static looksLikeRepaint(data: string): boolean {
    return (
      data.includes('\x1b[H') ||
      data.includes('\x1b[1;1H') ||
      data.includes('\x1b[1;1f') ||
      data.includes('\x1b[2J') ||
      data.includes('\x1b[3J') ||
      data.includes('\x1b[?1049') ||
      data.includes('\x1b[?2026h') ||
      data.includes('\x1b[?2026l')
    );
  }

  private writeOrBuffer(
    data: string,
    acknowledgement?: { generation: number; sequence: number }
  ): void {
    if (this.hasFlushed) {
      // Unfreeze chain step 1: the app's post-SIGWINCH repaint reaching us
      // (in-flight pre-resize chunks — spinners, streamed rows — must NOT
      // advance the chain; they would reveal the rewrapped buffer early).
      if (this.unfreezePhase === 'await-data' && FrontendPty.looksLikeRepaint(data)) {
        this.unfreezePhase = 'await-render';
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
    if (this.isDisposed || this.terminalWriteActive) return;
    const write = this.terminalWriteQueue[0];
    if (!write) return;
    if (write.offset >= write.data.length) {
      this.terminalWriteQueue.shift();
      write.onWritten?.();
      this.pumpTerminalWriteQueue();
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
   * Commit a resize as ONE atomic visual transition (rows + cols together).
   *
   * term.resize() synchronously clears the WebGL canvas and force-rewraps
   * the buffer; painted raw that is the white flash / garbled layout
   * (verified frame-by-frame via tracing screenshots).  The transition is
   * hidden behind a snapshot of the last presented frame and revealed by an
   * event chain — no timing assumptions:
   *
   *   freezeFrame()      snapshot canvas → overlay covers the terminal
   *   terminal.resize()  clear + rewrap happen under the overlay
   *   (caller sends rpc.pty.resize in the same tick → app repaints)
   *   unfreeze chain — shrink resizes keep the snapshot up until the app's
   *   post-SIGWINCH repaint; grow resizes keep it only until xterm has rendered
   *   the wider grid. In both directions the old frame remains visible while
   *   terminal.resize() clears and rebuilds the WebGL canvas underneath.
   *   then: next FULL-viewport onRender (partial renders would expose the
   *   cleared rest of the canvas) → one requestAnimationFrame (the redrawn
   *   canvas is presented) → overlay hidden.
   *   fallback timer: sessions with no TUI never send a repaint; their
   *   plain-text rewrap IS the correct final content, so reveal after
   *   UNFREEZE_FALLBACK_MS.
   *
   * A terminal that hasn't flushed its history yet has no frame worth
   * protecting and resizes bare.
   */
  commitResize(cols: number, rows: number): void {
    if (this.terminal.cols === cols && this.terminal.rows === rows) return;
    if (!this.hasFlushed) {
      this.terminal.resize(cols, rows);
      return;
    }
    const isShrink = cols < this.terminal.cols;
    // If a previous commit is still frozen, keep ITS snapshot (the canvas
    // underneath may be mid-transition garbage — re-snapshotting it would
    // put that garbage on the overlay) and just restart the unfreeze chain.
    const frozen = this.unfreezePhase !== 'idle' ? true : this.freezeFrame();
    // Arm before resize so the first full-viewport render produced by xterm
    // cannot race the subscription. Registering afterwards leaves the overlay
    // stale until the timeout; hiding it beforehand exposes the cleared WebGL
    // canvas as a visible blank flash.
    if (frozen) this.armUnfreeze(isShrink ? 'await-data' : 'await-render');
    this.terminal.resize(cols, rows);
  }

  private getWebglCanvas(): HTMLCanvasElement | null {
    if (!this.webglAddon) return null;
    // .xterm-screen hosts canvas.xterm-link-layer (2d) first, then the
    // unclassed WebGL render canvas. A bare `canvas` selector grabs the
    // transparent link layer and the freeze snapshot would be empty.
    return this.ownedContainer.querySelector<HTMLCanvasElement>(
      '.xterm-screen canvas:not(.xterm-link-layer)'
    );
  }

  private ensureFreezeOverlay(): HTMLCanvasElement {
    let overlay = this.freezeOverlay;
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.className = 'terminal-freeze-overlay';
      Object.assign(overlay.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        zIndex: '10',
        display: 'none',
      });
      this.ownedContainer.style.position = 'relative';
      this.freezeOverlay = overlay;
    }
    if (overlay.parentElement !== this.ownedContainer) {
      this.ownedContainer.appendChild(overlay);
    }
    return overlay;
  }

  private releaseFreezeOverlayBackingStore(): void {
    const overlay = this.freezeOverlay;
    if (!overlay) return;
    overlay.remove();
    // Resetting dimensions releases the full DPR-scaled pixel allocation.
    overlay.width = 0;
    overlay.height = 0;
    this.freezeOverlay = null;
    this.hasFreezeSnapshot = false;
    this.lastFreezeSnapshotAt = Number.NEGATIVE_INFINITY;
  }

  /**
   * Mirror the just-rendered WebGL frame onto the (hidden) freeze overlay. Runs
   * on every onRender because the WebGL canvas uses preserveDrawingBuffer:false;
   * that exposes valid pixels during the render frame without accumulating
   * stale glyphs across later composites. Skipped while a freeze is active so
   * the masking snapshot is never overwritten by mid-resize garbage.
   */
  private captureFreezeSnapshot(allowWhileFrozen = false): void {
    const now = performance.now();
    if (
      !this.isMounted ||
      (!allowWhileFrozen && now - this.lastFreezeSnapshotAt < FREEZE_SNAPSHOT_MIN_INTERVAL_MS) ||
      (!allowWhileFrozen && this.unfreezePhase !== 'idle')
    ) {
      return;
    }
    const canvas = this.getWebglCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    const overlay = this.ensureFreezeOverlay();
    try {
      if (overlay.width !== canvas.width) overlay.width = canvas.width;
      if (overlay.height !== canvas.height) overlay.height = canvas.height;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.drawImage(canvas, 0, 0);
    } catch {
      return;
    }
    overlay.style.width = canvas.style.width || `${canvas.width}px`;
    overlay.style.height = canvas.style.height || `${canvas.height}px`;
    this.hasFreezeSnapshot = true;
    this.lastFreezeSnapshotAt = now;
  }

  /**
   * Reveal the last captured frame so it covers the terminal during a resize.
   * Returns false when no usable snapshot exists yet (DOM renderer fallback,
   * nothing rendered, context lost) — the caller then resizes bare instead of
   * arming an unfreeze that has nothing to reveal.
   */
  private freezeFrame(): boolean {
    if (!this.hasFreezeSnapshot || !this.freezeOverlay) {
      return false;
    }
    this.freezeOverlay.style.display = 'block';
    return true;
  }

  /** Start the event chain that reveals the resized terminal — see commitResize. */
  private armUnfreeze(entryPhase: 'await-data' | 'await-render'): void {
    const generation = ++this.unfreezeGeneration;
    this.unfreezeRenderDisposable?.dispose();
    if (this.unfreezeFallbackTimer) clearTimeout(this.unfreezeFallbackTimer);
    this.unfreezePhase = entryPhase;
    this.unfreezeRenderDisposable = this.terminal.onRender((e) => {
      if (this.unfreezePhase !== 'await-render') return;
      if (e.start > 0 || e.end < this.terminal.rows - 1) return;
      // The full resized frame is valid now. Capture it while WebGL's drawing
      // buffer is readable so the next resize never reuses the older geometry.
      this.captureFreezeSnapshot(true);
      requestAnimationFrame(() => {
        if (generation === this.unfreezeGeneration) this.unfreeze();
      });
    });
    this.unfreezeFallbackTimer = setTimeout(() => {
      if (generation !== this.unfreezeGeneration) return;
      this.unfreeze();
      // Silent/plain-shell sessions may never send a repaint. Invalidate the
      // pre-resize capture and request one fresh frame for the next transition.
      this.invalidateFreezeSnapshot();
      this.redrawViewportFromBuffer();
    }, UNFREEZE_FALLBACK_MS);
  }

  /** Hide the overlay and reset the chain. Idempotent. */
  private unfreeze(): void {
    this.unfreezeGeneration += 1;
    this.unfreezePhase = 'idle';
    this.unfreezeRenderDisposable?.dispose();
    this.unfreezeRenderDisposable = null;
    if (this.unfreezeFallbackTimer) {
      clearTimeout(this.unfreezeFallbackTimer);
      this.unfreezeFallbackTimer = null;
    }
    if (this.freezeOverlay) this.freezeOverlay.style.display = 'none';
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
    // Mount dims are authoritative — drop any stale freeze overlay.
    this.unfreeze();
    this.invalidateFreezeSnapshot();
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    this.isMounted = true;
    this.applyRendererPreference();
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
    this.isMounted = false;
    this.cancelPendingConnect();
    this.unfreeze();
    this.invalidateFreezeSnapshot();
    this.releaseFreezeOverlayBackingStore();
    this.disposeWebglRenderer();
    this.setRendererState('dom', null);
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
    notifyTerminalRendererDiagnosticsChanged();
    this.isMounted = false;
    this.unfreeze();
    this.releaseFreezeOverlayBackingStore();
    this.terminalWriteQueue = [];
    this.terminalWriteActive = false;
    this.offData?.();
    this.offData = null;
    const connectedConsumerId = this.connectedConsumerId;
    this.connectedConsumerId = null;
    this.scrollDisposable.dispose();
    this.freezeSnapshotDisposable?.dispose();
    this.freezeSnapshotDisposable = null;
    this.webglContextLossDisposable?.dispose();
    this.webglContextLossDisposable = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
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

/** Apply and immediately redraw a renderer preference across every live terminal. */
export function applyRendererPreferenceToAll(renderer: unknown): TerminalRenderer {
  const normalized = normalizeTerminalRenderer(renderer);
  for (const pty of FrontendPty.all) {
    pty.setRendererPreference(normalized);
  }
  return normalized;
}

/** Dispose all live FrontendPty instances. Called on app teardown. */
export function disposeAllPtys(): void {
  for (const pty of [...FrontendPty.all]) {
    pty.dispose();
  }
}
