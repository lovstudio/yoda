import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type IDisposable, type ITerminalOptions } from '@xterm/xterm';
import { ptyDataChannel } from '@shared/events/ptyEvents';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { cssVar } from '@renderer/utils/cssVars';
import { log } from '@renderer/utils/logger';
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
 * an off-screen container. Call connect() to subscribe to the main-process
 * ring buffer and live IPC events — this writes historical output directly
 * to xterm and sets up ongoing data delivery without any renderer-side buffer.
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
  /** Last { cols, rows } sent to rpc.pty.resize(). Used by PaneSizingContext to skip redundant IPC calls. */
  lastSentDims: { cols: number; rows: number } | null = null;
  /**
   * Buffered output (historical + any live data) held while the terminal is
   * still off-screen at the constructor default cols/rows. Flushed on first
   * mount() after the terminal has been resized to real pane dimensions, so
   * scrollback never reflows from a stale default width.
   */
  private pendingWrites: string[] = [];
  private hasFlushed = false;
  private savedViewportY: number | null = null;
  /** Snapshot overlay hiding resize transitions — see commitResize(). */
  private freezeOverlay: HTMLCanvasElement | null = null;
  /** Unfreeze event chain state: idle → await-data → await-render → idle. */
  private unfreezePhase: 'idle' | 'await-data' | 'await-render' = 'idle';
  private unfreezeRenderDisposable: IDisposable | null = null;
  private unfreezeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scrollDisposable: { dispose(): void };
  private webglAddon: WebglAddon | null = null;
  private webglContextLossDisposable: IDisposable | null = null;

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
      convertEol: true,
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
          rpc.app.openExternal(text).catch((error) => {
            log.warn('FrontendPty: failed to open external link', { text, error });
          });
        },
      },
      theme: buildTheme(theme),
    });

    this.terminal.open(this.ownedContainer);
    this.loadWebglRenderer();
    this.scrollDisposable = this.terminal.onScroll((viewportY) => {
      this.savedViewportY = viewportY;
    });

    const el = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (el) {
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.backgroundColor = 'transparent';
    }

    ensureXtermHost().appendChild(this.ownedContainer);
    FrontendPty.all.add(this);
  }

  private loadWebglRenderer(): void {
    try {
      // preserveDrawingBuffer so the freeze-frame overlay (see
      // resizeNow/freezeFrameDuringResize) can reliably drawImage() the WebGL
      // canvas at any moment.
      const webglAddon = new WebglAddon(true);
      const contextLossDisposable = webglAddon.onContextLoss(() => {
        log.warn('FrontendPty: WebGL renderer context lost; falling back to DOM renderer', {
          sessionId: this.sessionId,
        });
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.webglAddon?.dispose();
        this.webglAddon = null;
        this.terminal.refresh(0, Math.max(0, this.terminal.rows - 1));
      });
      this.terminal.loadAddon(webglAddon);
      this.webglAddon = webglAddon;
      this.webglContextLossDisposable = contextLossDisposable;
    } catch (error) {
      log.debug('FrontendPty: WebGL renderer unavailable; using DOM renderer', {
        sessionId: this.sessionId,
        error: String(error),
      });
      this.webglContextLossDisposable?.dispose();
      this.webglContextLossDisposable = null;
      this.webglAddon?.dispose();
      this.webglAddon = null;
    }
  }

  setScrollbackLines(scrollbackLines: unknown): void {
    this.terminal.options.scrollback = normalizeTerminalScrollbackLines(scrollbackLines);
  }

  /**
   * Subscribe to the session: fetches the ring buffer from the main process,
   * writes it directly to xterm, then sets up a live IPC listener for future
   * data. Marks status as 'ready' once complete.
   *
   * The main process guarantees atomicity: subscribe() snapshots the ring
   * buffer and registers the consumer in one synchronous tick, so no data
   * can slip between the snapshot and the first live IPC event.
   */
  async connect(): Promise<void> {
    const result = await rpc.pty.subscribe(this.sessionId);
    const historical = result.success ? result.data.buffer : '';
    if (historical) this.writeOrBuffer(historical);
    this.offData = events.on(
      ptyDataChannel,
      (data: string) => {
        this.writeOrBuffer(data);
      },
      this.sessionId
    );
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
      data.includes('\x1b[2J') ||
      data.includes('\x1b[3J') ||
      data.includes('\x1b[?1049')
    );
  }

  private writeOrBuffer(data: string): void {
    if (this.hasFlushed) {
      // Unfreeze chain step 1: the app's post-SIGWINCH repaint reaching us
      // (in-flight pre-resize chunks — spinners, streamed rows — must NOT
      // advance the chain; they would reveal the rewrapped buffer early).
      if (this.unfreezePhase === 'await-data' && FrontendPty.looksLikeRepaint(data)) {
        this.unfreezePhase = 'await-render';
      }
      this.terminal.write(data);
    } else {
      this.pendingWrites.push(data);
    }
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
   *   unfreeze chain — entry phase depends on direction (user-chosen
   *   tradeoff: live-follow on grow, no garbling on shrink):
   *     GROW / rows-only ('await-render'): unwrapping is correct by
   *       construction, so reveal on the resize's own full redraw — live
   *       per-column tracking during drags.  (The transcript may shift
   *       vertically as line counts change; inherent to live reflow.)
   *     SHRINK ('await-data'): force-wrapping garbles TUI rows, so hold the
   *       snapshot until the app's repaint arrives (looksLikeRepaint in
   *       writeOrBuffer) — successive shrink commits keep the snapshot up,
   *       and the reveal happens when the app catches up.
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
    this.terminal.resize(cols, rows);
    if (frozen) this.armUnfreeze(isShrink ? 'await-data' : 'await-render');
  }

  private getWebglCanvas(): HTMLCanvasElement | null {
    if (!this.webglAddon) return null;
    // .xterm-screen hosts canvas.xterm-link-layer (2d) FIRST, then the
    // unclassed WebGL render canvas — a bare `canvas` selector grabs the
    // transparent link layer and the freeze snapshot would be empty.
    return this.ownedContainer.querySelector<HTMLCanvasElement>(
      '.xterm-screen canvas:not(.xterm-link-layer)'
    );
  }

  /**
   * Snapshot the current frame onto the overlay so it covers the terminal.
   * Returns false when no usable snapshot could be taken (DOM renderer
   * fallback, zero-sized canvas, context lost) — the caller then resizes
   * bare instead of arming an unfreeze that has nothing to reveal.
   */
  private freezeFrame(): boolean {
    const gl = this.getWebglCanvas();
    if (!gl || gl.width === 0 || gl.height === 0) return false;
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
      });
      this.ownedContainer.style.position = 'relative';
      this.freezeOverlay = overlay;
    }
    try {
      overlay.width = gl.width;
      overlay.height = gl.height;
      const ctx = overlay.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(gl, 0, 0);
    } catch {
      return false;
    }
    overlay.style.width = gl.style.width || `${gl.width}px`;
    overlay.style.height = gl.style.height || `${gl.height}px`;
    overlay.style.display = 'block';
    if (overlay.parentElement !== this.ownedContainer) {
      this.ownedContainer.appendChild(overlay);
    }
    return true;
  }

  /** Start the event chain that reveals the resized terminal — see commitResize. */
  private armUnfreeze(entryPhase: 'await-data' | 'await-render'): void {
    this.unfreezeRenderDisposable?.dispose();
    if (this.unfreezeFallbackTimer) clearTimeout(this.unfreezeFallbackTimer);
    this.unfreezePhase = entryPhase;
    this.unfreezeRenderDisposable = this.terminal.onRender((e) => {
      if (this.unfreezePhase !== 'await-render') return;
      if (e.start > 0 || e.end < this.terminal.rows - 1) return;
      requestAnimationFrame(() => this.unfreeze());
    });
    this.unfreezeFallbackTimer = setTimeout(() => this.unfreeze(), UNFREEZE_FALLBACK_MS);
  }

  /** Hide the overlay and reset the chain. Idempotent. */
  private unfreeze(): void {
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
    const buffered = this.pendingWrites.join('');
    this.pendingWrites = [];
    this.terminal.write(buffered, () => {
      try {
        this.terminal.scrollToBottom();
        this.savedViewportY = this.terminal.buffer.active.viewportY;
        this.terminal.refresh(0, this.terminal.rows - 1);
      } catch {}
    });
  }

  /**
   * Append ownedContainer to a visible mount target.
   * If targetDims are provided the terminal is resized BEFORE the appendChild
   * to eliminate the flash caused by a post-mount resize.
   */
  mount(mountTarget: HTMLElement, targetDims?: { cols: number; rows: number }): void {
    // Mount dims are authoritative — drop any stale freeze overlay.
    this.unfreeze();
    if (
      targetDims &&
      (this.terminal.cols !== targetDims.cols || this.terminal.rows !== targetDims.rows)
    ) {
      this.terminal.resize(targetDims.cols, targetDims.rows);
    }
    mountTarget.appendChild(this.ownedContainer);
    // Force a Canvas2D repaint after reparenting in the DOM.
    const t = this.terminal;
    const savedViewportY = this.savedViewportY;
    requestAnimationFrame(() => {
      try {
        if ((t as unknown as { _isDisposed?: boolean })._isDisposed) return;
        if (savedViewportY !== null) {
          t.scrollToLine(savedViewportY);
        }
        t.refresh(0, t.rows - 1);
      } catch {}
    });
  }

  /**
   * Move ownedContainer back to the off-screen host (tab deactivated /
   * TerminalPane unmounting).  Must be called after all ResizeObservers on
   * the visible mount target have been disconnected.
   */
  unmount(): void {
    ensureXtermHost().appendChild(this.ownedContainer);
  }

  /**
   * Permanently dispose this session (terminal or conversation deleted).
   * Unsubscribes from the main process, tears down the IPC data listener,
   * disposes the xterm Terminal, and removes the owned container from the DOM.
   */
  dispose(): void {
    FrontendPty.all.delete(this);
    this.unfreeze();
    this.freezeOverlay?.remove();
    this.freezeOverlay = null;
    this.offData?.();
    this.offData = null;
    this.scrollDisposable.dispose();
    this.webglContextLossDisposable?.dispose();
    this.webglContextLossDisposable = null;
    this.webglAddon?.dispose();
    this.webglAddon = null;
    rpc.pty.unsubscribe(this.sessionId).catch(() => {});
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
