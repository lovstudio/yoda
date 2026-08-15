import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import type { ConversationSurfaceAnchor } from '@shared/conversations';
import {
  PTY_CONSUMER_HEARTBEAT_INTERVAL_MS,
  ptyDataChannel,
  type PtyDataEvent,
} from '@shared/events/ptyEvents';
import {
  PTY_RENDER_CHECKPOINT_MAX_BYTES,
  PTY_RENDER_CHECKPOINT_SCROLLBACK_LINES,
  type PtyRenderCheckpoint,
} from '@shared/pty-render-checkpoint';
import { withTimeout } from '@shared/result';
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import {
  markTaskOpenFrameStage,
  type TaskOpenFrameDetails,
  type TaskOpenFrameStage,
} from '@renderer/lib/perf/task-open-frame-marks';
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
/**
 * A frame that was already proven canonical while hidden only needs a short
 * DOM-settlement window after it is reparented. A synchronized-output boundary
 * by itself is not that proof: Codex also wraps startup/loading/error redraws
 * in DEC 2026 transactions.
 */
const PREPARED_FRAME_SETTLEMENT_QUIET_MS = 120;
const FALLBACK_FIRST_FRAME_QUIET_MS = 700;
/**
 * How long the silence fence may keep a complete frame off screen.
 *
 * The fence asks the provider to stop writing, which a booting agent CLI does
 * not do: it draws a spinner or a startup log until it is done, restarting the
 * window on every burst. Waiting for silence therefore costs the provider's
 * whole startup, not the fence's nominal 700 ms — measured at ~5 s on a Codex
 * resume that had a cursor-complete frame in hand after 2.2 s. Spend this much
 * on silence, then accept the complete frame we are holding: an extra redraw
 * lands as one frame of churn, while the alternative is seconds of nothing.
 */
const CANONICAL_QUIET_HOLD_BUDGET_MS = 1_000;
/**
 * How long one ACK attempt may work before abandoning what it has.
 *
 * This used to share FIRST_FRAME_TIMEOUT_MS, which put the bound at 5 s — the
 * exact cost of a measured healthy open. That attempt validated its frame, sat
 * out the settlement window, and expired 9 ms before it could commit; the retry
 * then redid the whole thing, and the wasted attempt cost the open 670 ms.
 *
 * Abandoning an attempt is pure waste, not a safety valve: the caller's own
 * `waitForVisibleFrame` bound is what surfaces a slow open to React, and it
 * stays registered either way. So keep this well above any healthy cost.
 */
const VISIBLE_FRAME_ACK_ATTEMPT_TIMEOUT_MS = 15_000;
/**
 * Shortest a fence may park once its hold budget is already due.
 *
 * Only reached when the budget says "reveal" but some other condition still
 * holds the frame back. Re-check on a human-scale interval rather than spinning
 * the loop against a provider that has stopped writing.
 */
const CANONICAL_FENCE_PARK_FLOOR_MS = 250;
/**
 * Bound the subscribe round-trip generously. This is not a latency target: it
 * is the point at which we give up entirely, and giving up strands the caller
 * on its opening surface, because connect() rejections are intentionally
 * swallowed by callers that treat connection as best-effort.
 *
 * A measured healthy cold open on a developer machine took ~3.4 s here — main
 * is contended by worktree/agent spawns, directory scans and SQLite work while
 * a task opens, and the snapshot itself may serialize a headless xterm. A bound
 * anywhere near that latency aborts healthy opens; keep several times the
 * observed cost so only a genuinely stuck main process trips it.
 */
const PTY_SUBSCRIBE_ATTEMPT_TIMEOUT_MS = 15_000;
const FIRST_FRAME_CANCELLATION_POLL_MS = 25;
const PTY_CONSUMER_RELEASE_TIMEOUT_MS = 250;
const MIN_FIRST_FRAME_NON_EMPTY_LINES = 3;
const MIN_FIRST_FRAME_VISIBLE_CHARACTERS = 24;
const CANONICAL_SURFACE_SCAN_MAX_ROWS = 512;

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
  cancelSubscribeWait: (() => void) | null;
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

type ExpectedCanonicalSurfaceAnchor = {
  readonly generation: number;
  readonly kind: ConversationSurfaceAnchor['kind'];
  readonly segments: readonly string[];
};

type OutputActivityOutcome = 'activity' | 'elapsed' | 'cancelled';

type CanonicalRevealClaim = {
  readonly token: string;
  readonly generation: number;
  readonly expiresAt: number;
  shouldContinue: () => boolean;
  cancellationTimer: ReturnType<typeof setInterval>;
  expiryTimer: ReturnType<typeof setTimeout>;
};

type MountFrameOptions = {
  /**
   * Whether this DOM host may autonomously publish a visible-frame ACK.
   * Task-open staging passes a live predicate that stays false while the
   * outer semantic loading surface is opaque; its manager requests one
   * explicit claimed paint only after canonical preparation has completed.
   */
  autoAcknowledgeFrame?: boolean | (() => boolean);
  /**
   * Whether a known-live/working provider may use a complete DEC 2026 frame as
   * first-frame readiness without waiting for terminal silence. Keep this a
   * live predicate so React can revoke the permission as runtime state changes.
   * Historical and unknown-runtime sessions leave it disabled.
   */
  allowAtomicLiveFrame?: boolean | (() => boolean);
};

type VisibleFrameAckOptions = {
  /** Additional ownership/navigation predicate for one bounded ACK attempt. */
  shouldContinue?: () => boolean;
  /** Bound an explicit staging paint by the caller's absolute open deadline. */
  timeoutMs?: number;
};

type FrontendPtyOptions = {
  scrollbackLines?: number;
  /** Surface a terminal-output subscription failure to the owning PtySession. */
  onConnectionError?: (error: unknown) => void;
};

/** Normalize provider markdown and terminal wrapping into one comparable text stream. */
function normalizeCanonicalSurfaceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{Cf}\p{Cc}]+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Serialize one evicted renderer per browser idle slice. SerializeAddon must
// read xterm's in-memory buffer on this thread, but a policy change can evict
// many sessions at once; running those synchronous scans back-to-back would
// block input and navigation for seconds. The queue yields between snapshots
// and keeps the task being opened out of the eviction call stack.
let checkpointSerializationTail: Promise<void> = Promise.resolve();

function serializeCheckpointWhenIdle<T>(serialize: () => T): Promise<T> {
  const waitForIdle = () =>
    new Promise<void>((resolve) => {
      if (typeof globalThis.requestIdleCallback === 'function') {
        globalThis.requestIdleCallback(() => resolve(), { timeout: 250 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  const result = checkpointSerializationTail
    .catch(() => {})
    .then(waitForIdle)
    .then(serialize);
  checkpointSerializationTail = result.then(
    () => {},
    () => {}
  );
  return result;
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
        if (changed) pty.markCurrentVisibleFrameStage('frame-resize', { cols, rows });
        return changed;
      }
    }
    // Unknown session — never skip the resize.
    return true;
  }
  readonly terminal: Terminal;
  readonly ownedContainer: HTMLDivElement;
  private readonly serializeAddon = new SerializeAddon();
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
  /**
   * When output was last accepted, so a frame wait can report how stale the
   * screen it is guarding actually is.
   *
   * Every quiet fence is "wait N ms after the last byte". Without this the
   * profiler can see that a wait happened but not whether it was still hearing
   * from the provider — which is the difference between a fence that is too
   * conservative and a provider that is genuinely still drawing.
   */
  private lastOutputAtMs: number | null = null;
  /** Live output accepted while hidden since the adaptive-cache sampler last read it. */
  private hiddenOutputCodeUnits = 0;
  private outputActivityWaiters = new Set<() => void>();
  private canonicalStateGeneration = -1;
  private canonicalGenerationBaseline = '';
  private canonicalGenerationHasPayload = false;
  private expectedCanonicalGeneration: number | null = null;
  /** Provider transcript evidence required for the first visible frame of one generation. */
  private expectedCanonicalSurfaceAnchor: ExpectedCanonicalSurfaceAnchor | null = null;
  /** Latest output revision whose bytes have crossed xterm's parser boundary. */
  private canonicalParserDrainedRevision = -1;
  /** Exact parsed revision whose canonical buffer contains every ordered anchor segment. */
  private canonicalSurfaceAnchorMatchedRevision: number | null = null;
  /**
   * Exact revision already accepted by the surface-fence verifier.
   *
   * waitForCanonicalOutput() is the single owner of provider-fence semantics.
   * Once it has accepted a revision, the visible ACK loop must move on to the
   * DOM paint fence: re-entering the verifier for the same revision produces an
   * unbounded verify/re-verify cycle in which nothing ever paints.
   */
  private canonicalSurfaceFenceVerifiedRevision: number | null = null;
  /** A source-grid checkpoint needs backend output after being fit to another grid. */
  private canonicalOutputRequiredAfterRevision: number | null = null;
  /**
   * Generation whose silence-fence hold budget is being spent, and since when.
   *
   * Keyed by generation so a replacement generation starts its own budget: the
   * budget exists to bound "we are holding a complete frame the fence refuses",
   * and a new generation has not proven anything yet.
   */
  private canonicalQuietHoldGeneration: number | null = null;
  private canonicalQuietHoldSinceMs = 0;
  private preparedCanonicalGeneration: number | null = null;
  private preparedCanonicalRevision: number | null = null;
  /** Whether the prepared revision bypassed silence under a live-runtime fence. */
  private preparedCanonicalAtomicLive = false;
  /** This exact live generation has already crossed a visible canonical paint. */
  private hasShownCanonicalFrame = false;
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
  private mountAutoAcknowledgeFrame: (() => boolean) | null = null;
  private mountAllowAtomicLiveFrame: (() => boolean) | null = null;
  /** Exact revision currently crossing the live-frame DOM paint fence. */
  private atomicLiveFramePaintRevision: number | null = null;
  private atomicLiveFramePaintGeneration: number | null = null;
  private visibleFrameVisibilityListener: (() => void) | null = null;
  private visibleFrameWaiters = new Set<(ready: boolean) => void>();
  private visibleFrameStateListeners = new Set<(ready: boolean) => void>();
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
  /**
   * Main-process lease that prevents this exact backend generation from being
   * replaced between off-screen preparation and the routed browser paint.
   * The owning ConversationSession releases it only after the task is visible
   * and the canonical-frame signal has crossed React's commit boundary.
   */
  private canonicalRevealClaim: CanonicalRevealClaim | null = null;
  /** An expired delivery lease must be renewed before this generation can paint. */
  private canonicalRevealClaimRequiredGeneration: number | null = null;
  private isDisposed = false;
  private isDisposing = false;
  private disposePromise: Promise<void> | null = null;
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

  /** Backend generation represented by the currently parsed xterm scene. */
  get canonicalGeneration(): number {
    return this.outputGeneration;
  }

  /** Whether this off-screen cache already owns a fully parsed canonical frame. */
  get canRevealImmediately(): boolean {
    return (
      this.hasRecoverableSnapshot &&
      !this.terminalWriteActive &&
      this.terminalWriteQueue.length === 0 &&
      this.hasShownCanonicalFrame &&
      !this.synchronizedOutputOpen &&
      !this.resetBeforeNextLiveGeneration
    );
  }

  /** Revoke the synchronous hot route after a failed main-generation fence. */
  invalidateHotReveal(): void {
    this.releaseCanonicalRevealClaim();
    this.invalidateVisibleFrame({ hide: this.isMounted });
    this.hasShownCanonicalFrame = false;
    this.preparedCanonicalGeneration = null;
    this.preparedCanonicalRevision = null;
    this.preparedCanonicalAtomicLive = false;
  }

  /**
   * Atomically reserve the currently parsed canonical generation in main.
   *
   * A one-shot getSessionState probe cannot order an Electron invoke reply
   * against a later generation-start event and browser paint. This claim is
   * tied to the subscribed consumer and exact generation instead: a provider
   * that has already announced replacement makes the claim fail, while a
   * later provider waits until the visible route has painted or been aborted.
   */
  async acquireCanonicalRevealClaim(
    shouldContinue: () => boolean = () => true,
    timeoutMs = 250,
    options: { requireMountedFramePaint?: boolean } = {}
  ): Promise<boolean> {
    const startedAt = performance.now();
    const finishClaim = async (): Promise<boolean> => {
      if (!options.requireMountedFramePaint) return true;
      const deadline = startedAt + timeoutMs;
      const claim = this.canonicalRevealClaim;
      if (
        performance.now() >= deadline ||
        !claim ||
        claim.generation !== this.outputGeneration ||
        !this.hasClaimableCanonicalFrame()
      ) {
        this.releaseCanonicalRevealClaim();
        return false;
      }
      const stillOwnsClaim = () =>
        shouldContinue() &&
        this.canonicalRevealClaim === claim &&
        claim.generation === this.outputGeneration;
      while (stillOwnsClaim() && performance.now() < deadline) {
        // Chromium does not promise a compositor paint for a hidden document.
        // Hold this single claim until visibility returns or the original task-
        // open deadline expires; returning false immediately would make the
        // manager spin through fresh claims while the app stays backgrounded.
        const canPaint = await this.waitForDocumentPaintOpportunity(stillOwnsClaim, deadline);
        if (!canPaint) break;
        const painted = await this.completeVisibleFrameAck(this.mountGeneration, {
          shouldContinue: stillOwnsClaim,
          timeoutMs: Math.max(0, deadline - performance.now()),
        });
        if (painted) return true;
        if (typeof document === 'undefined' || document.visibilityState !== 'hidden') break;
      }
      this.releaseCanonicalRevealClaim();
      return false;
    };
    const existing = this.canonicalRevealClaim;
    if (existing) {
      if (
        Date.now() < existing.expiresAt &&
        existing.generation === this.outputGeneration &&
        existing.shouldContinue() &&
        shouldContinue()
      ) {
        existing.shouldContinue = shouldContinue;
        return finishClaim();
      }
      this.releaseCanonicalRevealClaim();
    }

    const consumerId = this.connectedConsumerId;
    const generation = this.outputGeneration;
    if (!consumerId || !shouldContinue() || !this.hasClaimableCanonicalFrame()) return false;

    const request = rpc.pty.claimGenerationReveal(this.sessionId, consumerId, generation);
    const result = await new Promise<Awaited<typeof request> | null>((resolve) => {
      let settled = false;
      let cancellationTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (cancellationTimer !== null) clearInterval(cancellationTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      };
      const finish = (value: Awaited<typeof request> | null) => {
        if (settled) {
          if (value?.success)
            void rpc.pty.releaseGenerationReveal(value.data.token).catch(() => {});
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      cancellationTimer = setInterval(() => {
        if (this.isDisposed || this.isDisposing || !shouldContinue()) finish(null);
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      timeoutTimer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
      request.then(finish, () => finish(null));
    });

    if (!result?.success) return false;
    if (
      this.isDisposed ||
      this.isDisposing ||
      !shouldContinue() ||
      this.connectedConsumerId !== consumerId ||
      this.outputGeneration !== generation
    ) {
      void rpc.pty.releaseGenerationReveal(result.data.token).catch(() => {});
      return false;
    }

    const claim: CanonicalRevealClaim = {
      token: result.data.token,
      generation,
      expiresAt: result.data.expiresAt,
      shouldContinue,
      cancellationTimer: setInterval(() => {
        if (
          this.isDisposed ||
          this.isDisposing ||
          !claim.shouldContinue() ||
          this.outputGeneration !== claim.generation
        ) {
          this.releaseCanonicalRevealClaim();
        }
      }, FIRST_FRAME_CANCELLATION_POLL_MS),
      expiryTimer: setTimeout(
        () => this.expireCanonicalRevealClaim(claim),
        // Invalidate slightly before main's timer so browser/main scheduling
        // jitter cannot leave a nominally-held but already-unlocked old frame.
        Math.max(0, result.data.expiresAt - Date.now() - FIRST_FRAME_CANCELLATION_POLL_MS)
      ),
    };
    this.canonicalRevealClaim = claim;
    this.canonicalRevealClaimRequiredGeneration = null;
    return finishClaim();
  }

  /** Release the exact-generation lease after visible paint or abort. */
  releaseCanonicalRevealClaim(): void {
    const claim = this.canonicalRevealClaim;
    if (!claim) return;
    this.canonicalRevealClaim = null;
    clearInterval(claim.cancellationTimer);
    clearTimeout(claim.expiryTimer);
    this.canonicalRevealClaimRequiredGeneration = null;
    void rpc.pty.releaseGenerationReveal(claim.token).catch(() => {});
  }

  private expireCanonicalRevealClaim(claim: CanonicalRevealClaim): void {
    if (this.canonicalRevealClaim !== claim) return;
    this.canonicalRevealClaim = null;
    clearInterval(claim.cancellationTimer);
    clearTimeout(claim.expiryTimer);
    this.canonicalRevealClaimRequiredGeneration = claim.generation;
    void rpc.pty.releaseGenerationReveal(claim.token).catch(() => {});
    this.invalidateVisibleFrame({ hide: this.isMounted });
    for (const resolve of this.visibleFrameWaiters) resolve(false);
    this.visibleFrameWaiters.clear();
  }

  private hasClaimableCanonicalFrame(): boolean {
    if (
      this.connectedConsumerId === null ||
      this.isDisposed ||
      this.isDisposing ||
      this.terminalWriteActive ||
      this.terminalWriteQueue.length > 0 ||
      this.pendingWrites.length > 0 ||
      this.suspendedWrites.length > 0 ||
      this.synchronizedOutputOpen ||
      this.resetBeforeNextLiveGeneration ||
      !this.hasCanonicalViewport()
    ) {
      return false;
    }
    return (
      this.canRevealImmediately ||
      (this.preparedCanonicalGeneration === this.outputGeneration &&
        this.preparedCanonicalRevision === this.outputRevision)
    );
  }

  /** A pressure eviction is safe only after main owns a snapshot/watermark for this consumer. */
  get hasRecoverableSnapshot(): boolean {
    return (
      this.connectedConsumerId !== null &&
      this.hasResolvedInitialSnapshot &&
      this.initialSnapshotParserDrained &&
      this.pendingWrites.length === 0 &&
      this.suspendedWrites.length === 0
    );
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
    private readonly options: FrontendPtyOptions = {}
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
        options.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
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
    this.terminal.loadAddon(this.serializeAddon);
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
      this.isDisposing ||
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
    } catch (error) {
      if (!this.isDisposed && !this.isDisposing) {
        try {
          this.options.onConnectionError?.(error);
        } catch (callbackError) {
          log.warn('[pty-renderer] connection error callback failed', {
            sessionId: this.sessionId,
            error: callbackError,
          });
        }
      }
      throw error;
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
      if (this.isDisposed || this.isDisposing || !shouldContinue()) return false;
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
    if (this.isDisposed || this.isDisposing || !shouldContinue()) return Promise.resolve(false);
    if (
      this.canonicalRevealClaimRequiredGeneration !== null &&
      this.canonicalRevealClaimRequiredGeneration === this.outputGeneration &&
      this.canonicalRevealClaim === null
    ) {
      const startedAt = performance.now();
      return this.acquireCanonicalRevealClaim(shouldContinue, Math.min(timeoutMs, 250)).then(
        (claimed) => {
          if (!claimed || !shouldContinue()) return false;
          return this.waitForVisibleFrame(
            shouldContinue,
            Math.max(0, timeoutMs - (performance.now() - startedAt))
          );
        }
      );
    }
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
      timeoutTimer = setTimeout(() => finish(false), boundedTimeoutMs);
      if (this.isVisibleMountLease(this.mountGeneration)) {
        this.scheduleVisibleFrameAck(this.mountGeneration);
      }
      if (this.isVisibleFrameReady()) finish(true);
    });
  }

  /**
   * Observe semantic first-frame readiness across backend generations.
   *
   * React keeps the stable session-opening surface above xterm until this
   * signal becomes true. A generation-start sentinel publishes false before
   * the previous process is reset, so the same FrontendPty instance cannot
   * leave React believing that an old process frame is still safe to expose.
   */
  subscribeVisibleFrameState(listener: (ready: boolean) => void): () => void {
    if (this.isDisposed) {
      listener(false);
      return () => {};
    }
    this.visibleFrameStateListeners.add(listener);
    listener(this.isVisibleFrameReady());
    return () => this.visibleFrameStateListeners.delete(listener);
  }

  /**
   * Re-arm the frame ACK now that the mount owner's readiness gate has opened.
   *
   * `autoAcknowledgeFrame` is a pull-only predicate: the loop asks whether the
   * owner is ready at the moment it happens to be scheduled, and nothing asks
   * again when the answer changes. Output events were assumed to cover that,
   * but a settled TUI stops producing them — so a gate that opened just after a
   * refused attempt waited out the owner's own retry period while the backend
   * already had a frame in hand. The document-visibility path solves the same
   * problem by listening for the gate to open; this is the equivalent push for
   * the React half.
   *
   * Scheduling is idempotent, so an already-running attempt is left alone.
   */
  notifyFrameAcknowledgementGateOpened(): void {
    if (this.isDisposed || this.isDisposing) return;
    if (!this.isVisibleMountLease(this.mountGeneration)) return;
    this.scheduleVisibleFrameAck(this.mountGeneration);
  }

  /** Require the next canonical-frame wait to represent this exact backend generation. */
  expectCanonicalGeneration(generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 0) return;
    if (
      this.preparedCanonicalGeneration !== null &&
      generation > this.preparedCanonicalGeneration
    ) {
      this.preparedCanonicalGeneration = null;
      this.preparedCanonicalRevision = null;
      this.preparedCanonicalAtomicLive = false;
    }
    // Backend generations are monotonic. A late resize/probe completion from
    // G must never lower the expectation after a G+1 sentinel or subscription
    // snapshot has already become authoritative.
    this.expectedCanonicalGeneration = Math.max(
      this.expectedCanonicalGeneration ?? 0,
      this.outputGeneration,
      generation
    );
  }

  /**
   * Bind provider transcript evidence to one backend generation.
   *
   * `anchor` is a positive text fast path; an independently provider-confirmed
   * live turn may supersede it when a newer prompt has already moved the text
   * out of the viewport. `none` is an explicit new-session declaration and
   * therefore continues to require the provider turn fence. `live-turn` is
   * provider-owned proof that a restored turn is still open, so its exact
   * generation may use a complete cursor-ready DEC frame without searching for
   * transcript text that has scrolled away.
   * `unverifiable` has no text fast path; it still requires an exact-generation,
   * parser-drained, cursor-complete synchronized frame and the bounded quiet
   * fallback, so missing transcript evidence cannot strand a healthy session.
   */
  expectCanonicalSurfaceAnchor(generation: number, surfaceAnchor: ConversationSurfaceAnchor): void {
    if (!Number.isSafeInteger(generation) || generation < this.outputGeneration) return;
    const segments =
      surfaceAnchor.kind === 'anchor'
        ? surfaceAnchor.segments.map(normalizeCanonicalSurfaceText).filter(Boolean)
        : [];
    this.expectedCanonicalSurfaceAnchor = {
      generation,
      kind:
        surfaceAnchor.kind === 'anchor' && segments.length === 0
          ? 'unverifiable'
          : surfaceAnchor.kind,
      segments,
    };
    this.canonicalSurfaceAnchorMatchedRevision = null;
    this.canonicalSurfaceFenceVerifiedRevision = null;
    this.preparedCanonicalGeneration = null;
    this.preparedCanonicalRevision = null;
    this.preparedCanonicalAtomicLive = false;
    this.expectCanonicalGeneration(generation);
    if (
      generation === this.outputGeneration &&
      this.canonicalParserDrainedRevision >= this.outputRevision
    ) {
      this.refreshCanonicalSurfaceAnchorMatch(generation, this.outputRevision);
    }
  }

  /** Whether main has bound provider surface evidence to this exact generation. */
  hasCanonicalSurfaceFence(generation: number): boolean {
    return this.expectedCanonicalSurfaceAnchor?.generation === generation;
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
      cancelSubscribeWait: null,
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

    let result: Awaited<ReturnType<typeof rpc.pty.subscribe>> | null;
    try {
      result = await this.waitForSubscribeAttempt(
        attempt,
        rpc.pty.subscribe(this.sessionId, attempt.consumerId)
      );
    } catch (error) {
      this.cancelConnectAttempt(attempt);
      throw error;
    }

    if (!result || attempt.cancelled || this.isDisposed) {
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
      const mountedDimensions = { cols: this.terminal.cols, rows: this.terminal.rows };
      const checkpointDimensions =
        'checkpointDimensions' in snapshot ? snapshot.checkpointDimensions : undefined;
      const checkpointGridMatchesTarget =
        !checkpointDimensions ||
        (checkpointDimensions.cols === mountedDimensions.cols &&
          checkpointDimensions.rows === mountedDimensions.rows);
      if (
        checkpointDimensions &&
        (checkpointDimensions.cols !== mountedDimensions.cols ||
          checkpointDimensions.rows !== mountedDimensions.rows)
      ) {
        this.terminal.resize(checkpointDimensions.cols, checkpointDimensions.rows);
      }
      this.noteOutputActivity();
      const initialSnapshotRevision = this.outputRevision;
      this.observeCanonicalPayload(snapshot.buffer, this.outputRevision);
      this.writeOrBuffer(
        snapshot.buffer,
        {
          generation: snapshot.generation,
          sequence: snapshot.sequence,
        },
        () => {
          if (
            this.terminal.cols !== mountedDimensions.cols ||
            this.terminal.rows !== mountedDimensions.rows
          ) {
            this.terminal.resize(mountedDimensions.cols, mountedDimensions.rows);
          }
          this.noteCanonicalParserDrained(snapshot.generation, initialSnapshotRevision);
          this.initialSnapshotParserDrained = true;
          // A compact checkpoint was serialized from a fully parsed xterm at
          // this exact generation/sequence watermark. Requiring another
          // 700 ms output-quiet heuristic after parsing it adds latency but no
          // correctness: subsequent live events advance outputRevision and
          // invalidate this prepared revision before it can be revealed.
          if (
            snapshot.checkpointCanonical === true &&
            checkpointGridMatchesTarget &&
            this.outputGeneration === snapshot.generation &&
            this.outputRevision === initialSnapshotRevision &&
            this.hasCanonicalViewport()
          ) {
            this.preparedCanonicalGeneration = snapshot.generation;
            this.preparedCanonicalRevision = initialSnapshotRevision;
            this.preparedCanonicalAtomicLive = false;
          }
          if (!checkpointGridMatchesTarget) {
            // Resizing serialized alternate-screen cells cannot invent the
            // backend's newly exposed rows and columns. Wait for the SIGWINCH
            // redraw issued by generation-bound staging instead of treating a
            // stretched 80x24 framebuffer as a complete 144x45 frame.
            this.canonicalOutputRequiredAfterRevision = initialSnapshotRevision;
          }
          if (checkpointDimensions && snapshot.checkpointCanonical !== true) {
            // A compact checkpoint with downgraded provenance may be an exact
            // parser state in the middle of "Loading workspace" or a partial
            // synchronized repaint. Quiet time alone cannot upgrade it. Main's
            // tracker will mark a later complete DEC transaction canonical;
            // otherwise require live output beyond this checkpoint revision.
            this.canonicalOutputRequiredAfterRevision = initialSnapshotRevision;
          }
          console.log('[DEBUG][agent-session-load] snapshot parser drained:', {
            sessionId: this.sessionId,
            snapshotCharacters: snapshot.buffer.length,
            parserMs: Math.round((performance.now() - snapshotReceivedAt) * 10) / 10,
            elapsedMs: Math.round((performance.now() - subscriptionStartedAt) * 10) / 10,
            compactCheckpoint: checkpointDimensions !== undefined,
          });
          if (this.hasResolvedInitialSnapshot && this.isVisibleMountLease(this.mountGeneration)) {
            this.scheduleVisibleFrameAck(this.mountGeneration);
          }
        }
      );
    } else if (snapshot.sequence > 0) {
      this.noteOutputActivity();
      this.acknowledgeOutput(snapshot.generation, snapshot.sequence);
      this.noteCanonicalParserDrained(snapshot.generation, this.outputRevision);
      this.initialSnapshotParserDrained = true;
    } else {
      this.noteCanonicalParserDrained(snapshot.generation, this.outputRevision);
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

  private waitForSubscribeAttempt(
    attempt: PendingConnectAttempt,
    request: ReturnType<typeof rpc.pty.subscribe>
  ): Promise<Awaited<typeof request> | null> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
        if (attempt.cancelSubscribeWait === cancelWait) {
          attempt.cancelSubscribeWait = null;
        }
      };
      const finish = (value: Awaited<typeof request> | null) => {
        if (settled) {
          // A timeout/unmount can race a main handler that creates the consumer
          // immediately before returning. Repeat unsubscribe after the late
          // reply so that ordering cannot strand that consumer in main.
          if (value) void rpc.pty.unsubscribe(this.sessionId, attempt.consumerId).catch(() => {});
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const cancelWait = () => finish(null);
      attempt.cancelSubscribeWait = cancelWait;
      timeoutTimer = setTimeout(() => {
        if (settled) return;
        const error = new Error(
          `PTY output subscription timed out after ${PTY_SUBSCRIBE_ATTEMPT_TIMEOUT_MS} ms`
        );
        // Reject this one explicit attempt before cancellation so connect()
        // cannot classify it as a remount cancellation and auto-retry.
        fail(error);
        this.cancelConnectAttempt(attempt);
      }, PTY_SUBSCRIBE_ATTEMPT_TIMEOUT_MS);
      request.then(finish, fail);
    });
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
    attempt.cancelSubscribeWait?.();
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
    if (event.generation > this.outputGeneration) {
      const previousGeneration = this.outputGeneration;
      this.releaseCanonicalRevealClaim();
      this.canonicalRevealClaimRequiredGeneration = null;
      // Invalidate the old process while its complete frame is still present.
      // The empty seq=0 generation-start event must never clear a terminal that
      // React still considers visible-frame ready.
      this.invalidateVisibleFrame({ hide: true });
      this.beginCanonicalGeneration(event.generation);
      // Main's generation-start event is authoritative. A staging lease for a
      // process that was replaced between preparation and route commit must
      // follow the replacement instead of waiting forever for the old number.
      this.expectedCanonicalGeneration = event.generation;
      this.lastOutputSequence = 0;
      this.acknowledgedGeneration = event.generation;
      this.acknowledgedSequence = 0;
      this.resetBeforeNextLiveGeneration = false;
      // A backend generation is a new terminal process, not an append to the
      // previous process's framebuffer. Invalidate and clear the old scene as
      // soon as main publishes generation start (before its first output
      // batch), while the owned container is hidden. This prevents a partial
      // G+1 repaint from being composited over G's cursor/grid.
      this.visibleFrameSettlementPending = true;
      this.visibleFrameSettlementOutputRevision = this.outputRevision;
      this.noteOutputActivity();
      this.writeTerminalData(RESET_TERMINAL_SEQUENCE, () => {
        if (this.isVisibleMountLease(this.mountGeneration)) {
          this.scheduleVisibleFrameAck(this.mountGeneration);
        }
      });
      log.debug('[pty-renderer] live generation changed', {
        sessionId: this.sessionId,
        previousGeneration,
        generation: event.generation,
        firstSequence: event.sequence,
        resetHistoricalScreen: true,
      });
    }
    if (event.sequence <= this.lastOutputSequence) return;

    this.lastOutputSequence = event.sequence;
    if (!this.isMounted) this.hiddenOutputCodeUnits += event.data.length;
    this.noteOutputActivity({ deferAtomicPaintInvalidation: true });
    const eventRevision = this.outputRevision;
    this.observeCanonicalPayload(event.data, eventRevision);
    this.reconcileAtomicLivePaintAfterAcceptedOutput();
    this.writeOrBuffer(
      event.data,
      {
        generation: event.generation,
        sequence: event.sequence,
      },
      () => {
        this.noteCanonicalParserDrained(event.generation, eventRevision);
        if (this.isVisibleMountLease(this.mountGeneration)) {
          this.scheduleVisibleFrameAck(this.mountGeneration);
        }
      }
    );
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
    if (this.isDisposed || this.isDisposing) return;
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
    if (
      this.expectedCanonicalGeneration !== null &&
      generation > this.expectedCanonicalGeneration
    ) {
      this.expectedCanonicalGeneration = generation;
    }
    if (this.canonicalStateGeneration === generation) return;
    // Keep provider evidence bound to the generation that produced it. The
    // generation mismatch fails closed below, while hasCanonicalSurfaceFence()
    // lets the renderer distinguish "freshly checked but unverifiable" from
    // "main has not supplied evidence for this replacement yet".
    this.hasShownCanonicalFrame = false;
    this.preparedCanonicalGeneration = null;
    this.preparedCanonicalRevision = null;
    this.preparedCanonicalAtomicLive = false;
    this.canonicalStateGeneration = generation;
    this.canonicalParserDrainedRevision = -1;
    this.canonicalSurfaceAnchorMatchedRevision = null;
    this.canonicalSurfaceFenceVerifiedRevision = null;
    this.canonicalGenerationBaseline = this.readViewportContent().signature;
    this.canonicalGenerationHasPayload = false;
    this.synchronizedOutputOpen = false;
    this.synchronizedOutputCursorShown = false;
    this.synchronizedOutputCompletedRevision = null;
    this.synchronizedOutputCompletedWithCursorRevision = null;
    this.synchronizedOutputScanTail = '';
    this.canonicalOutputRequiredAfterRevision = null;
    this.canonicalQuietHoldGeneration = null;
    this.atomicLiveFramePaintGeneration = null;
    this.atomicLiveFramePaintRevision = null;
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
        const completedWithCursor = this.synchronizedOutputCursorShown;
        this.synchronizedOutputCompletedRevision = revision;
        this.synchronizedOutputCompletedWithCursorRevision = completedWithCursor ? revision : null;
        this.synchronizedOutputOpen = false;
        this.synchronizedOutputCursorShown = false;
      }
      offset = endIndex + SYNCHRONIZED_OUTPUT_END.length;
    }
    this.synchronizedOutputScanTail = scan.slice(-SYNCHRONIZED_OUTPUT_SCAN_OVERLAP);
  }

  private noteOutputActivity(options: { deferAtomicPaintInvalidation?: boolean } = {}): void {
    const defersCurrentAtomicPaint =
      options.deferAtomicPaintInvalidation === true &&
      this.atomicLiveFramePaintGeneration !== null &&
      this.atomicLiveFramePaintRevision !== null;
    if (
      (this.preparedCanonicalRevision !== null || this.visibleFrameSettlementPending) &&
      this.isVisibleMountLease(this.mountGeneration) &&
      this.visibleFrameMountGeneration !== this.mountGeneration &&
      !defersCurrentAtomicPaint
    ) {
      // The prepared frame was exposed synchronously, but has not crossed its
      // render/paint ACK yet. Hide it before any newer bytes reach xterm so a
      // clear/loading transition cannot flash between the old and new frames.
      this.ownedContainer.style.visibility = 'hidden';
    }
    this.outputRevision += 1;
    this.visualFrameRevision += 1;
    this.lastOutputAtMs = performance.now();
    // Once a live generation has crossed its first canonical paint, normal
    // streaming output is terminal content rather than another loading phase.
    // Keep React's semantic-ready signal stable; explicit generation changes
    // call invalidateVisibleFrame() before clearing the old process instead.
    if (
      !this.hasShownCanonicalFrame ||
      this.preparedCanonicalRevision !== null ||
      this.visibleFrameSettlementPending
    ) {
      this.visibleFrameMountGeneration = 0;
    }
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

  /** Read only the canonical bottom viewport while preserving soft-wrap ordering. */
  private readCanonicalSurfaceViewport(): string {
    const buffer = this.terminal.buffer.active;
    const logicalLines: string[] = [];
    const start = Math.max(0, buffer.baseY);
    const end = Math.min(
      buffer.length,
      start + Math.min(this.terminal.rows, CANONICAL_SURFACE_SCAN_MAX_ROWS)
    );
    for (let row = start; row < end; row += 1) {
      const line = buffer.getLine(row);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && logicalLines.length > 0) {
        logicalLines[logicalLines.length - 1] += text;
      } else {
        logicalLines.push(text);
      }
    }
    return normalizeCanonicalSurfaceText(logicalLines.join('\n'));
  }

  private refreshCanonicalSurfaceAnchorMatch(generation: number, revision: number): void {
    if (generation !== this.outputGeneration || revision > this.outputRevision) return;
    this.canonicalParserDrainedRevision = Math.max(this.canonicalParserDrainedRevision, revision);
    const expected = this.expectedCanonicalSurfaceAnchor;
    if (
      !expected ||
      expected.generation !== generation ||
      expected.kind !== 'anchor' ||
      expected.segments.length === 0
    ) {
      this.canonicalSurfaceAnchorMatchedRevision = null;
      return;
    }

    const canonicalViewport = this.readCanonicalSurfaceViewport();
    let offset = 0;
    for (const segment of expected.segments) {
      const index = canonicalViewport.indexOf(segment, offset);
      if (index < 0) {
        this.canonicalSurfaceAnchorMatchedRevision = null;
        return;
      }
      offset = index + segment.length;
    }
    this.canonicalSurfaceAnchorMatchedRevision = revision;
  }

  private noteCanonicalParserDrained(generation: number, revision: number): void {
    this.refreshCanonicalSurfaceAnchorMatch(generation, revision);
    // A complete raw DEC transaction may temporarily preserve an older
    // painted candidate while xterm parses the replacement. Revalidate as
    // soon as that replacement drains so an anchor-less loading/error frame is
    // hidden before the browser can paint it.
    this.reconcileAtomicLivePaintAfterAcceptedOutput();
  }

  private hasCanonicalViewport(): boolean {
    if (
      this.resetBeforeNextLiveGeneration ||
      this.canonicalStateGeneration !== this.outputGeneration ||
      !this.canonicalGenerationHasPayload ||
      (this.expectedCanonicalGeneration !== null &&
        this.outputGeneration !== this.expectedCanonicalGeneration) ||
      (this.canonicalOutputRequiredAfterRevision !== null &&
        this.outputRevision <= this.canonicalOutputRequiredAfterRevision)
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

  private shouldAllowAtomicLiveFrame(): boolean {
    try {
      return this.mountAllowAtomicLiveFrame?.() ?? false;
    } catch {
      return false;
    }
  }

  private hasAtomicLiveFence(generation: number): boolean {
    const expected = this.expectedCanonicalSurfaceAnchor;
    if (expected && expected.generation === generation) {
      if (expected.kind === 'anchor') return true;
      if (expected.kind === 'live-turn') return true;
      if (expected.kind === 'unverifiable') return this.shouldAllowAtomicLiveFrame();
      // An explicitly new session has no historical replay to verify, but it
      // must still wait for the provider-owned turn-start fence.
    } else if (expected && expected.generation !== generation) {
      return false;
    }
    return this.shouldAllowAtomicLiveFrame();
  }

  /**
   * Some provider fences must remain fail-closed until a newer frame arrives:
   * a new session has not proved that its first turn started, and a live turn
   * still needs one complete provider-owned redraw. Transcript anchors are
   * different: they are a positive fast path, not a permanent veto. A settled
   * answer can legitimately live in scrollback outside the bottom viewport,
   * while `unverifiable` only means the bounded transcript probe had no text
   * evidence. Both may fall back to an exact-generation, cursor-complete DEC
   * frame after the normal quiet fence.
   */
  private hasBlockingCanonicalSurfaceFence(generation: number): boolean {
    const expected = this.expectedCanonicalSurfaceAnchor;
    if (!expected) return false;
    if (expected.generation !== generation) return true;
    return expected.kind === 'none' || expected.kind === 'live-turn';
  }

  private hasStructuralCanonicalSurfaceFallback(generation: number, revision: number): boolean {
    const expected = this.expectedCanonicalSurfaceAnchor;
    return (
      expected !== null &&
      expected.generation === generation &&
      (expected.kind === 'anchor' || expected.kind === 'unverifiable') &&
      this.canonicalParserDrainedRevision >= revision &&
      this.synchronizedOutputCompletedWithCursorRevision === revision
    );
  }

  private isAtomicLiveRevisionReady(generation: number, revision: number): boolean {
    const expected = this.expectedCanonicalSurfaceAnchor;
    if (expected && expected.generation === generation) {
      if (expected.kind === 'anchor') {
        return (
          this.canonicalParserDrainedRevision >= revision &&
          (this.canonicalSurfaceAnchorMatchedRevision === revision ||
            this.shouldAllowAtomicLiveFrame()) &&
          this.synchronizedOutputCompletedWithCursorRevision === revision
        );
      }
      if (expected.kind === 'live-turn') {
        return (
          this.canonicalParserDrainedRevision >= revision &&
          this.synchronizedOutputCompletedWithCursorRevision === revision
        );
      }
      if (expected.kind === 'unverifiable') {
        return (
          this.shouldAllowAtomicLiveFrame() &&
          this.canonicalParserDrainedRevision >= revision &&
          this.synchronizedOutputCompletedWithCursorRevision === revision
        );
      }
    } else if (expected && expected.generation !== generation) {
      return false;
    }
    return (
      this.shouldAllowAtomicLiveFrame() &&
      this.synchronizedOutputCompletedWithCursorRevision === revision
    );
  }

  /**
   * `null` means the provider-owned live fence or structural atomic frame is
   * incomplete; `0` means this exact revision may proceed to the DOM paint
   * fence. Provider readiness now owns semantic filtering, so adding another
   * wall-clock delay here would only recreate high-frequency starvation.
   */
  private atomicLiveFrameGraceRemaining(generation: number, revision: number): number | null {
    if (!this.hasAtomicLiveFence(generation)) {
      return null;
    }
    if (
      generation <= 0 ||
      generation !== this.outputGeneration ||
      this.canonicalStateGeneration !== generation ||
      this.synchronizedOutputOpen ||
      !this.isAtomicLiveRevisionReady(generation, revision) ||
      revision !== this.outputRevision ||
      this.resetBeforeNextLiveGeneration ||
      (this.expectedCanonicalGeneration !== null &&
        generation !== this.expectedCanonicalGeneration) ||
      this.terminalWriteActive ||
      this.terminalWriteQueue.length > 0 ||
      this.pendingWrites.length > 0 ||
      this.suspendedWrites.length > 0 ||
      !this.hasResolvedInitialSnapshot ||
      !this.initialSnapshotParserDrained ||
      !this.hasCanonicalViewport()
    ) {
      return null;
    }
    return 0;
  }

  /**
   * A painted atomic candidate remains safe while later same-generation output
   * is itself a complete synchronized transaction. We acknowledge the exact
   * candidate revision's DOM render; newer live revisions may queue behind it
   * without forcing the browser to find an impossible global-silence window.
   */
  private isAtomicLivePaintLeaseSafe(generation: number, revision: number): boolean {
    if (
      this.atomicLiveFramePaintGeneration !== generation ||
      this.atomicLiveFramePaintRevision !== revision ||
      this.outputGeneration !== generation ||
      this.canonicalStateGeneration !== generation ||
      !this.hasAtomicLiveFence(generation) ||
      this.resetBeforeNextLiveGeneration ||
      this.synchronizedOutputOpen ||
      (this.expectedCanonicalGeneration !== null && generation !== this.expectedCanonicalGeneration)
    ) {
      return false;
    }
    if (this.outputRevision === revision) return true;

    // The candidate revision already crossed the provider/transcript fence.
    // A later complete DEC synchronized transaction keeps xterm's DOM on that
    // old complete frame until the parser commits the replacement atomically.
    // Do not demand that the replacement parser drain between two browser
    // frames: at 60 Hz that quiet window does not exist and would starve a
    // perfectly valid session forever. Split/open transactions still revoke
    // the lease synchronously through `synchronizedOutputOpen` above.
    if (this.synchronizedOutputCompletedWithCursorRevision !== this.outputRevision) return false;
    if (this.canonicalParserDrainedRevision < this.outputRevision) return true;

    // Once xterm has parsed the replacement, provider-turn fences may accept
    // any complete same-generation frame. Transcript fences are stricter:
    // refreshCanonicalSurfaceAnchorMatch() must have found the anchor again in
    // the replacement viewport, otherwise reconcileAtomicLivePaint... hides
    // the container before that DOM revision reaches a browser paint.
    return this.isAtomicLiveRevisionReady(generation, this.outputRevision);
  }

  private reconcileAtomicLivePaintAfterAcceptedOutput(): void {
    const generation = this.atomicLiveFramePaintGeneration;
    const revision = this.atomicLiveFramePaintRevision;
    if (generation === null || revision === null) return;
    if (this.isAtomicLivePaintLeaseSafe(generation, revision)) return;
    this.atomicLiveFramePaintGeneration = null;
    this.atomicLiveFramePaintRevision = null;
    if (this.isVisibleMountLease(this.mountGeneration) && !this.isVisibleFrameReady()) {
      this.ownedContainer.style.visibility = 'hidden';
    }
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

      // The hold budget has to be consulted here, before every `continue` below.
      // Charging it inside the quiet-fallback branch was useless against the
      // provider it was written for: while a CLI streams, each iteration sees
      // the revision move during the drain and loops from the top, so the
      // branch that held the budget was first reached only once the provider had
      // already gone quiet. A measured resume spent 2s in that hole and reported
      // `heldMs: 0` on arrival.
      const canonicalViewportReady = this.hasCanonicalViewport();
      const quietHoldSpent = this.trackCanonicalQuietHold(
        this.outputGeneration,
        canonicalViewportReady
      );
      if (
        quietHoldSpent &&
        canonicalViewportReady &&
        // Structural completeness, and only that. No open DEC transaction plus a
        // drained parser means the scene in the buffer is a whole frame — that is
        // what prevents a torn reveal, and it is not negotiable.
        //
        // The cursor-shown bit is a different claim: it says the TUI finished its
        // redraw and handed the cursor back. That is a *readiness* signal, i.e.
        // exactly the thing the hold budget exists to stop waiting for. Requiring
        // it here made the budget almost inert — a measured resume held a
        // complete frame from 1.9s, spent its budget at 2.9s, and still waited
        // until 5.4s for the provider to emit a cursor-showing transaction.
        // Worst case now is a complete screen whose cursor is briefly hidden;
        // that is a different order of defect from a half-drawn one.
        !this.synchronizedOutputOpen &&
        this.canonicalParserDrainedRevision >= this.outputRevision &&
        // New and live-turn fences stay fail-closed no matter the budget: they
        // are waiting on the provider to declare a turn, and revealing early
        // shows a surface the provider has not written yet.
        !this.hasBlockingCanonicalSurfaceFence(this.outputGeneration)
      ) {
        const heldGeneration = this.outputGeneration;
        const heldRevision = this.outputRevision;
        this.markCurrentVisibleFrameStage('frame-quiet-wait', {
          reason: 'hold-budget-spent',
          waitMs: 0,
          heldMs: Math.round(performance.now() - this.canonicalQuietHoldSinceMs),
          revision: heldRevision,
          ...this.canonicalFenceDetails(heldRevision),
        });
        this.preparedCanonicalGeneration = heldGeneration;
        this.preparedCanonicalRevision = heldRevision;
        this.preparedCanonicalAtomicLive = false;
        this.canonicalSurfaceFenceVerifiedRevision = heldRevision;
        return true;
      }

      // Output accepted while the sentinel was in xterm's queue sits after it.
      if (revisionBeforeDrain !== this.outputRevision) continue;

      const generation = this.outputGeneration;
      const revision = this.outputRevision;
      if (
        this.preparedCanonicalGeneration === generation &&
        this.preparedCanonicalRevision === revision &&
        this.hasCanonicalViewport() &&
        (this.expectedCanonicalSurfaceAnchor === null ||
          this.isAtomicLiveRevisionReady(generation, revision))
      ) {
        this.canonicalSurfaceFenceVerifiedRevision = revision;
        return true;
      }
      if (this.hasCanonicalViewport() && !this.synchronizedOutputOpen) {
        const atomicLiveGraceMs = this.atomicLiveFrameGraceRemaining(generation, revision);
        if (atomicLiveGraceMs !== null) {
          if (atomicLiveGraceMs > 0) {
            const graceOutcome = await this.waitForOutputActivityOrDelay(
              revision,
              atomicLiveGraceMs,
              shouldContinue,
              deadline
            );
            if (graceOutcome === 'cancelled') return false;
            if (graceOutcome === 'activity') continue;
          }

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
            this.atomicLiveFrameGraceRemaining(generation, revision) !== 0
          ) {
            continue;
          }
          this.preparedCanonicalGeneration = generation;
          this.preparedCanonicalRevision = revision;
          this.preparedCanonicalAtomicLive = true;
          this.canonicalSurfaceFenceVerifiedRevision = revision;
          return true;
        }

        if (this.hasBlockingCanonicalSurfaceFence(generation)) {
          // New/live sessions still require their provider-owned fence. A
          // settled transcript anchor is handled below as a positive fast path
          // with a structural fallback, so scrollback cannot strand the task.
          this.markCurrentVisibleFrameStage('frame-canonical-wait', {
            reason: 'blocking-fence',
            revision,
            ...this.canonicalFenceDetails(revision),
          });
          const fencedActivity = await this.waitForOutputActivityOrDelay(
            revision,
            Math.max(0, deadline - performance.now()),
            shouldContinue,
            deadline
          );
          if (fencedActivity !== 'activity') return false;
          continue;
        }

        if (
          this.expectedCanonicalSurfaceAnchor !== null &&
          !this.hasStructuralCanonicalSurfaceFallback(generation, revision)
        ) {
          this.markCurrentVisibleFrameStage('frame-canonical-wait', {
            reason: 'anchor-fallback-missing',
            revision,
            ...this.canonicalFenceDetails(revision),
          });
          // Park only as long as the hold budget allows. Parking to the whole
          // attempt deadline assumed more output was coming; when the provider
          // has finished, it is the rest of the attempt spent waiting for a byte
          // that will never arrive, and it outlives the budget it should defer
          // to. An elapsed park is not a failure — loop and let the budget
          // decide.
          const fencedActivity = await this.waitForOutputActivityOrDelay(
            revision,
            this.canonicalFenceParkMs(deadline, generation),
            shouldContinue,
            deadline
          );
          if (fencedActivity === 'cancelled') return false;
          continue;
        }

        // DEC synchronized output proves that one terminal redraw ended
        // atomically; it does not prove the provider finished restoring the
        // conversation. In particular, Codex emits complete synchronized
        // loading frames before replaying history. Keep the semantic first-
        // frame guard conservative until a provider-owned readiness fence is
        // available.
        //
        // Conservative cannot mean unbounded, though: see the hold budget at the
        // top of this loop, which bounds how long a complete frame may be kept
        // off screen while the provider keeps writing.
        const quietMs = FALLBACK_FIRST_FRAME_QUIET_MS;
        this.markCurrentVisibleFrameStage('frame-quiet-wait', {
          reason: 'canonical-fallback',
          waitMs: quietMs,
          heldMs: Math.round(performance.now() - this.canonicalQuietHoldSinceMs),
          revision,
          ...this.canonicalFenceDetails(revision),
        });
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
        this.preparedCanonicalAtomicLive = false;
        this.canonicalSurfaceFenceVerifiedRevision = revision;
        return true;
      }

      // Either the viewport is not canonical yet or a synchronized redraw is
      // still open. Both mean the frame in hand is incomplete, so wait out the
      // whole attempt for the next one rather than painting a torn screen.
      this.markCurrentVisibleFrameStage('frame-canonical-wait', {
        reason: this.hasCanonicalViewport() ? 'synchronized-open' : 'viewport-incomplete',
        revision,
      });
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

  private waitForDocumentPaintOpportunity(
    shouldContinue: () => boolean,
    deadline: number
  ): Promise<boolean> {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      return Promise.resolve(shouldContinue() && performance.now() < deadline);
    }
    if (!shouldContinue() || performance.now() >= deadline) return Promise.resolve(false);

    return new Promise((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const cleanup = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (pollTimer !== null) clearInterval(pollTimer);
        if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      };
      const finish = (visible: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(visible && shouldContinue() && performance.now() < deadline);
      };
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'hidden') finish(true);
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      pollTimer = setInterval(() => {
        if (!shouldContinue() || performance.now() >= deadline) finish(false);
      }, FIRST_FRAME_CANCELLATION_POLL_MS);
      timeoutTimer = setTimeout(() => finish(false), Math.max(0, deadline - performance.now()));
      onVisibilityChange();
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

  private shouldAutoAcknowledgeFrame(mountLease: number): boolean {
    if (mountLease !== this.mountGeneration) return false;
    try {
      return this.mountAutoAcknowledgeFrame?.() ?? true;
    } catch {
      return false;
    }
  }

  private clearVisibleFrameVisibilityListener(): void {
    const listener = this.visibleFrameVisibilityListener;
    if (!listener || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', listener);
    this.visibleFrameVisibilityListener = null;
  }

  /**
   * A hidden Chromium document cannot produce a meaningful paint ACK and may
   * throttle rAF for seconds. Do not occupy the single in-flight slot while it
   * is hidden; arm one lease-bound listener and retry immediately on visibility.
   */
  private scheduleVisibleFrameAckWhenDocumentVisible(mountLease: number): boolean {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      this.clearVisibleFrameVisibilityListener();
      return false;
    }
    if (this.visibleFrameVisibilityListener !== null) return true;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') return;
      this.clearVisibleFrameVisibilityListener();
      if (
        this.isVisibleMountLease(mountLease) &&
        !this.isVisibleFrameReady() &&
        this.shouldAutoAcknowledgeFrame(mountLease)
      ) {
        this.scheduleVisibleFrameAck(mountLease);
      }
    };
    this.visibleFrameVisibilityListener = onVisibilityChange;
    document.addEventListener('visibilitychange', onVisibilityChange);
    return true;
  }

  private publishVisibleFrameState(ready: boolean): void {
    for (const listener of this.visibleFrameStateListeners) listener(ready);
  }

  private invalidateVisibleFrame(options: { hide: boolean }): void {
    this.visibleFrameMountGeneration = 0;
    if (options.hide && this.isVisibleMountLease(this.mountGeneration)) {
      this.ownedContainer.style.visibility = 'hidden';
    }
    this.publishVisibleFrameState(false);
  }

  private commitVisibleFrame(mountLease: number, path: 'hot' | 'canonical'): boolean {
    const claim = this.canonicalRevealClaim;
    if (claim && Date.now() >= claim.expiresAt) {
      this.expireCanonicalRevealClaim(claim);
      return false;
    }
    if (
      this.canonicalRevealClaimRequiredGeneration !== null &&
      this.canonicalRevealClaimRequiredGeneration === this.outputGeneration &&
      claim === null
    ) {
      this.invalidateVisibleFrame({ hide: true });
      return false;
    }
    this.visibleFrameMountGeneration = mountLease;
    // Mark before publishing. The publish runs its React listeners
    // synchronously and the task-open trace is completed inside one of them, so
    // a paint marked afterwards is dropped into a closed trace — which is how
    // the paint itself went missing from the trajectory it was meant to explain.
    this.markVisibleFrameStage(mountLease, 'frame-painted', { path });
    this.publishVisibleFrameState(true);
    return true;
  }

  /**
   * Report a frame-loop wait to the task-open profiler. Gated on this lease
   * owning the visible DOM host: an off-screen cache warming in the background
   * is not what the user is waiting on, and attributing its waits to the open
   * would invent dead air that never existed on screen.
   */
  private markVisibleFrameStage(
    mountLease: number,
    stage: TaskOpenFrameStage,
    details?: TaskOpenFrameDetails
  ): void {
    if (this.debugVisibleMount?.lease !== mountLease) return;
    markTaskOpenFrameStage(stage, {
      sessionId: this.sessionId,
      sinceOutputMs:
        this.lastOutputAtMs === null ? null : Math.round(performance.now() - this.lastOutputAtMs),
      ...details,
    });
  }

  /**
   * Mark against whichever visible mount currently owns this pty.
   *
   * The canonical wait is reachable from a parser callback as well as from the
   * ACK loop, so it has no lease of its own to check. Attributing its waits to
   * the current visible mount is still correct — an off-screen preparation has
   * no `debugVisibleMount` and is therefore silently skipped, which is what we
   * want: the profiler measures what the user is waiting to see.
   */
  private markCurrentVisibleFrameStage(
    stage: TaskOpenFrameStage,
    details?: TaskOpenFrameDetails
  ): void {
    const lease = this.debugVisibleMount?.lease;
    if (lease === undefined) return;
    this.markVisibleFrameStage(lease, stage, details);
  }

  /**
   * What the fence is currently holding out for.
   *
   * A fence wait reported as a bare reason tells the reader that we refused a
   * frame, not which of several independent conditions refused it. Naming the
   * anchor kind and whether its text was found is the difference between "main
   * had no transcript evidence" and "the evidence never appeared on screen" —
   * two findings with opposite fixes that produce the same mark otherwise.
   */
  private canonicalFenceDetails(revision: number): TaskOpenFrameDetails {
    const anchor = this.expectedCanonicalSurfaceAnchor;
    return {
      anchorKind: anchor?.kind ?? null,
      anchorSegments: anchor?.segments.length ?? 0,
      anchorMatched: this.canonicalSurfaceAnchorMatchedRevision === revision,
      allowAtomicLive: this.shouldAllowAtomicLiveFrame(),
      cursorComplete: this.synchronizedOutputCompletedWithCursorRevision === revision,
      parserDrained: this.canonicalParserDrainedRevision >= revision,
    };
  }

  /**
   * How long a fence may park waiting for the next byte.
   *
   * Parking to the attempt deadline is only correct if more output is coming.
   * When the provider has finished, that park spends the entire remaining
   * attempt waiting for a byte that will never arrive — and it outlives the hold
   * budget, which is the thing that should decide when to stop waiting. A
   * measured open parked 11.2s past its provider's last byte that way.
   *
   * So park until the budget is due, then let the loop re-evaluate. The floor
   * keeps a due budget from turning the wait into a spin: the top-of-loop check
   * normally reveals the frame before the park is reached again, and if some
   * other condition holds it back, we re-check on a sane interval instead of
   * burning the CPU.
   */
  private canonicalFenceParkMs(deadline: number, generation: number): number {
    const untilDeadlineMs = Math.max(0, deadline - performance.now());
    if (this.canonicalQuietHoldGeneration !== generation) return untilDeadlineMs;
    const untilBudgetDueMs =
      this.canonicalQuietHoldSinceMs + CANONICAL_QUIET_HOLD_BUDGET_MS - performance.now();
    return Math.min(untilDeadlineMs, Math.max(CANONICAL_FENCE_PARK_FLOOR_MS, untilBudgetDueMs));
  }

  /**
   * Charge the silence-fence hold budget and report whether it is spent.
   *
   * The clock starts when this generation first owns a complete viewport, not
   * when the wait begins: before that there is nothing to reveal, and a budget
   * running during the provider's loading screen would authorize revealing the
   * loading screen — the regression staging exists to prevent. From that point
   * on we are only waiting for the provider to stop writing, which is the wait
   * that needs a bound.
   */
  private trackCanonicalQuietHold(generation: number, hasCanonicalViewport: boolean): boolean {
    if (!hasCanonicalViewport) return false;
    if (this.canonicalQuietHoldGeneration !== generation) {
      this.canonicalQuietHoldGeneration = generation;
      this.canonicalQuietHoldSinceMs = performance.now();
      return false;
    }
    return performance.now() - this.canonicalQuietHoldSinceMs >= CANONICAL_QUIET_HOLD_BUDGET_MS;
  }

  /**
   * Whether this generation already spent its silence budget in the verifier.
   *
   * The settlement fence would otherwise re-impose the same 700 ms wait on the
   * revision the verifier just accepted, moving the stall one layer up instead
   * of removing it — and against a streaming provider that wait cannot converge
   * either. A DOM settlement window is still warranted; the silence one is not.
   */
  private hasSpentCanonicalQuietHold(generation: number): boolean {
    return (
      this.canonicalQuietHoldGeneration === generation &&
      performance.now() - this.canonicalQuietHoldSinceMs >= CANONICAL_QUIET_HOLD_BUDGET_MS
    );
  }

  private scheduleVisibleFrameAck(mountLease: number): void {
    // Report why an ACK was refused. Every branch here used to return in
    // silence, which is how a multi-second wait for the React gate could show
    // up in the profiler as dead air belonging to nobody.
    if (!this.isVisibleMountLease(mountLease) || this.isVisibleFrameReady()) return;
    if (!this.shouldAutoAcknowledgeFrame(mountLease)) {
      this.markVisibleFrameStage(mountLease, 'frame-ack-blocked', { reason: 'react-gate' });
      return;
    }
    if (this.visibleFrameAckMountGenerationInFlight === mountLease) return;
    if (this.scheduleVisibleFrameAckWhenDocumentVisible(mountLease)) {
      this.markVisibleFrameStage(mountLease, 'frame-ack-blocked', { reason: 'document-hidden' });
      return;
    }
    this.visibleFrameAckMountGenerationInFlight = mountLease;
    void this.completeVisibleFrameAck(mountLease, {
      // Read the live React-owned predicate throughout the attempt. A task can
      // enter staging after an ACK was scheduled; that edge must cancel the
      // old autonomous attempt before it can publish readiness under the Logo.
      shouldContinue: () => this.shouldAutoAcknowledgeFrame(mountLease),
    }).finally(() => {
      if (this.visibleFrameAckMountGenerationInFlight === mountLease) {
        this.visibleFrameAckMountGenerationInFlight = 0;
      }
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        this.isVisibleMountLease(mountLease) &&
        !this.isVisibleFrameReady() &&
        this.shouldAutoAcknowledgeFrame(mountLease)
      ) {
        this.scheduleVisibleFrameAckWhenDocumentVisible(mountLease);
      }
    });
  }

  private async completeVisibleFrameAck(
    mountLease: number,
    options: VisibleFrameAckOptions = {}
  ): Promise<boolean> {
    const isCurrentMount = () =>
      this.isVisibleMountLease(mountLease) &&
      (options.shouldContinue?.() ?? true) &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const deadline =
      performance.now() +
      Math.min(VISIBLE_FRAME_ACK_ATTEMPT_TIMEOUT_MS, options.timeoutMs ?? Infinity);
    while (isCurrentMount() && performance.now() < deadline) {
      // A cold visible mount starts before listener-first subscription resolves.
      // Keep it hidden until the snapshot and any events crossing that boundary
      // have entered the same ordered parser queue.
      if (!this.hasResolvedInitialSnapshot) {
        this.markVisibleFrameStage(mountLease, 'frame-snapshot-wait');
        return false;
      }

      const preparedRevision = this.preparedCanonicalRevision;
      const preparedAtomicLive = this.preparedCanonicalAtomicLive;
      // A terminal generation that has already been shown is a live terminal,
      // not a startup transaction. It may be continuously producing output,
      // so waiting for a 120/700 ms quiet window can starve until the five-
      // second fallback. Refresh its existing canonical DOM scene once and
      // reveal it; xterm then continues streaming normally, exactly as a
      // standalone terminal does.
      if (
        this.hasShownCanonicalFrame &&
        preparedRevision === null &&
        !this.visibleFrameSettlementPending &&
        !this.synchronizedOutputOpen &&
        !this.terminalWriteActive &&
        this.terminalWriteQueue.length === 0 &&
        this.pendingWrites.length === 0 &&
        this.suspendedWrites.length === 0
      ) {
        const hotGeneration = this.outputGeneration;
        const hotRevision = this.outputRevision;
        const hotVisualRevision = this.visualFrameRevision;
        const isHotFrameCurrent = () =>
          isCurrentMount() &&
          this.outputGeneration === hotGeneration &&
          this.outputRevision === hotRevision &&
          this.visualFrameRevision === hotVisualRevision &&
          !this.synchronizedOutputOpen;
        const renderRevision = this.terminalRenderRevision;
        this.redrawViewportFromBuffer();
        const rendered = await this.waitForTerminalRenderAfter(
          renderRevision,
          isHotFrameCurrent,
          deadline
        );
        if (!rendered) break;
        const rowsCommitted = await this.waitForPromiseWithin(
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          isHotFrameCurrent,
          deadline
        );
        if (!rowsCommitted || !isHotFrameCurrent()) break;
        this.ownedContainer.style.visibility = '';
        const painted = await this.waitForPromiseWithin(
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          isHotFrameCurrent,
          deadline
        );
        if (!painted || !isHotFrameCurrent()) {
          this.ownedContainer.style.visibility = 'hidden';
          break;
        }
        if (!this.commitVisibleFrame(mountLease, 'hot')) break;
        for (const resolve of this.visibleFrameWaiters) resolve(true);
        this.visibleFrameWaiters.clear();
        const visibleMount =
          this.debugVisibleMount?.lease === mountLease ? this.debugVisibleMount : null;
        console.log('[DEBUG][agent-session-load] hot visible frame painted:', {
          sessionId: this.sessionId,
          elapsedMs: visibleMount
            ? Math.round((performance.now() - visibleMount.startedAt) * 10) / 10
            : null,
        });
        if (visibleMount) this.debugVisibleMount = null;
        return true;
      }

      if (preparedRevision !== null && this.outputRevision !== preparedRevision) {
        // Output changed after off-screen preparation. Keep the routed terminal
        // hidden until the new generation/frame reaches canonical readiness too.
        this.ownedContainer.style.visibility = 'hidden';
        if (
          preparedAtomicLive &&
          this.preparedCanonicalGeneration === this.outputGeneration &&
          this.hasAtomicLiveFence(this.outputGeneration)
        ) {
          // A continuously repainting live TUI can replace a complete atomic
          // preparation before the visible ACK loop observes it. Do not chase
          // exact revisions through waitForCanonicalOutput(): discard the stale
          // preparation and let the next loop drain and validate the current
          // revision before acquiring its atomic DOM-paint lease.
          this.preparedCanonicalGeneration = null;
          this.preparedCanonicalRevision = null;
          this.preparedCanonicalAtomicLive = false;
          continue;
        }
        this.markVisibleFrameStage(mountLease, 'frame-canonical-wait', {
          reason: 'revision-changed',
        });
        const canonical = await this.waitForCanonicalOutput(isCurrentMount, deadline);
        if (!canonical) break;
        continue;
      }

      const stableRevision = this.outputRevision;
      const stableVisualRevision = this.visualFrameRevision;
      const stableGeneration = this.outputGeneration;
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

      const preparedConservatively = preparedRevision === stableRevision && !preparedAtomicLive;
      let atomicLiveGraceMs = preparedConservatively
        ? null
        : this.atomicLiveFrameGraceRemaining(this.outputGeneration, stableRevision);
      if (
        atomicLiveGraceMs === null &&
        this.expectedCanonicalSurfaceAnchor !== null &&
        this.canonicalSurfaceFenceVerifiedRevision !== stableRevision
      ) {
        // completeVisibleFrameAck can be scheduled directly from a parser
        // callback without going through prepareFirstFrame(). Route every
        // explicit fence through the same verifier: new/live sessions remain
        // fail-closed, while settled anchors may cross its cursor-complete,
        // parser-drained quiet fallback when text lives only in scrollback.
        //
        // Skip the verifier once it has already accepted this exact revision.
        // waitForCanonicalOutput() only records a *prepared* revision, which
        // preparedConservatively then reads as "no atomic-live grace", routing
        // the loop straight back into the verifier. Re-verifying an accepted
        // revision spins forever and the terminal never reaches its DOM paint.
        this.markVisibleFrameStage(mountLease, 'frame-canonical-wait', {
          reason: 'surface-anchor-fence',
        });
        const canonical = await this.waitForCanonicalOutput(isCurrentMount, deadline);
        if (!canonical) break;
        continue;
      }
      if (preparedAtomicLive && atomicLiveGraceMs === null) {
        // Runtime state revoked the live-frame permission after preparation.
        // Downgrade to the normal semantic quiet fence before this revision can
        // paint; a stale React predicate must never leave a fast-path lease.
        const quietOutcome = await this.waitForOutputActivityOrDelay(
          stableRevision,
          FALLBACK_FIRST_FRAME_QUIET_MS,
          isCurrentMount,
          deadline
        );
        if (quietOutcome === 'cancelled') break;
        if (quietOutcome === 'activity') continue;
        const downgradedDrainRevision = this.outputRevision;
        const downgradedParserDrained = await this.waitForPromiseWithin(
          this.waitForTerminalWrites(),
          isCurrentMount,
          deadline
        );
        if (
          !downgradedParserDrained ||
          downgradedDrainRevision !== this.outputRevision ||
          stableRevision !== this.outputRevision ||
          stableVisualRevision !== this.visualFrameRevision ||
          !this.hasCanonicalViewport()
        ) {
          continue;
        }
        this.preparedCanonicalAtomicLive = false;
        atomicLiveGraceMs = null;
      }
      if (atomicLiveGraceMs !== null && atomicLiveGraceMs > 0) {
        this.markVisibleFrameStage(mountLease, 'frame-quiet-wait', {
          reason: 'atomic-live-grace',
          waitMs: Math.round(atomicLiveGraceMs),
        });
        const graceOutcome = await this.waitForOutputActivityOrDelay(
          stableRevision,
          atomicLiveGraceMs,
          isCurrentMount,
          deadline
        );
        if (graceOutcome === 'cancelled') break;
        // Re-enter through parser drain even when only the wall-clock grace
        // elapsed; the current revision and queue state are re-read together.
        continue;
      }
      const atomicLivePaintRevision = atomicLiveGraceMs === 0 ? stableRevision : null;

      if (this.visibleFrameSettlementPending) {
        if (atomicLivePaintRevision === null) {
          const outputChangedDuringSettlement =
            this.outputRevision !== this.visibleFrameSettlementOutputRevision;
          const frameWasPreparedAtCurrentRevision =
            preparedRevision !== null &&
            preparedRevision === this.outputRevision &&
            !preparedAtomicLive;
          const quietMs = outputChangedDuringSettlement
            ? (frameWasPreparedAtCurrentRevision &&
                this.synchronizedOutputCompletedWithCursorRevision === this.outputRevision) ||
              this.hasSpentCanonicalQuietHold(this.outputGeneration)
              ? PREPARED_FRAME_SETTLEMENT_QUIET_MS
              : FALLBACK_FIRST_FRAME_QUIET_MS
            : PREPARED_FRAME_SETTLEMENT_QUIET_MS;
          this.markVisibleFrameStage(mountLease, 'frame-quiet-wait', {
            reason: 'settlement',
            waitMs: quietMs,
          });
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
        }
        if (this.savedAtBottom) {
          this.terminal.scrollToBottom();
          this.savedViewportY = this.terminal.buffer.active.viewportY;
        }
      }

      // Parser-idle is not equivalent to a complete process frame. In
      // particular, a generation-start sentinel contains no payload and a TUI
      // repaint can be split across several PTY chunks. Keep the terminal
      // hidden until this exact generation owns a non-trivial, transaction-
      // complete viewport; later output wakes this wait and retries the ACK.
      const canonicalFrameRequired =
        this.expectedCanonicalGeneration !== null ||
        this.canonicalOutputRequiredAfterRevision !== null ||
        this.preparedCanonicalGeneration !== null;
      if (this.synchronizedOutputOpen || (canonicalFrameRequired && !this.hasCanonicalViewport())) {
        this.markVisibleFrameStage(mountLease, 'frame-canonical-wait', {
          synchronizedOutputOpen: this.synchronizedOutputOpen,
          outputGeneration: this.outputGeneration,
        });
        const activity = await this.waitForOutputActivityOrDelay(
          stableRevision,
          Math.max(0, deadline - performance.now()),
          isCurrentMount,
          deadline
        );
        if (activity === 'activity') continue;
        break;
      }

      const renderRevision = this.terminalRenderRevision;
      this.atomicLiveFramePaintGeneration =
        atomicLivePaintRevision === null ? null : stableGeneration;
      this.atomicLiveFramePaintRevision = atomicLivePaintRevision;
      this.redrawViewportFromBuffer();
      let rendered: boolean;
      let rowsCommitted: boolean;
      if (atomicLivePaintRevision !== null) {
        // refresh() schedules xterm before this callback. For a continuously
        // repainting live TUI, combine render observation with the first of the
        // two browser frames; a separate render wait would require three rAFs
        // and make a stable window impossible at ~25 Hz.
        rowsCommitted = await this.waitForPromiseWithin(
          new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          isCurrentMount,
          deadline
        );
        rendered = rowsCommitted && this.terminalRenderRevision > renderRevision;
      } else {
        rendered = await this.waitForTerminalRenderAfter(renderRevision, isCurrentMount, deadline);
        rowsCommitted =
          rendered &&
          (await this.waitForPromiseWithin(
            new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
            isCurrentMount,
            deadline
          ));
      }
      if (!rendered) {
        this.atomicLiveFramePaintGeneration = null;
        this.atomicLiveFramePaintRevision = null;
        if (isCurrentMount()) continue;
        break;
      }
      if (!rowsCommitted) break;
      if (
        atomicLivePaintRevision !== null
          ? !this.isAtomicLivePaintLeaseSafe(stableGeneration, atomicLivePaintRevision)
          : stableGeneration !== this.outputGeneration ||
            stableRevision !== this.outputRevision ||
            stableVisualRevision !== this.visualFrameRevision
      ) {
        if (
          preparedRevision !== null ||
          this.visibleFrameSettlementPending ||
          atomicLivePaintRevision !== null
        ) {
          this.ownedContainer.style.visibility = 'hidden';
        }
        this.atomicLiveFramePaintGeneration = null;
        this.atomicLiveFramePaintRevision = null;
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
        atomicLivePaintRevision !== null
          ? !this.isAtomicLivePaintLeaseSafe(stableGeneration, atomicLivePaintRevision)
          : stableGeneration !== this.outputGeneration ||
            stableRevision !== this.outputRevision ||
            stableVisualRevision !== this.visualFrameRevision
      ) {
        if (
          preparedRevision !== null ||
          this.visibleFrameSettlementPending ||
          atomicLivePaintRevision !== null
        ) {
          this.ownedContainer.style.visibility = 'hidden';
        }
        this.atomicLiveFramePaintGeneration = null;
        this.atomicLiveFramePaintRevision = null;
        continue;
      }

      this.atomicLiveFramePaintGeneration = null;
      this.atomicLiveFramePaintRevision = null;
      if (!this.commitVisibleFrame(mountLease, 'canonical')) break;
      this.visibleFrameSettlementPending = false;
      this.hasShownCanonicalFrame =
        !this.resetBeforeNextLiveGeneration && this.hasCanonicalViewport();
      if (this.hasShownCanonicalFrame) this.expectedCanonicalGeneration = null;
      this.preparedCanonicalGeneration = null;
      this.preparedCanonicalRevision = null;
      this.preparedCanonicalAtomicLive = false;
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
      return true;
    }

    // Never reveal an unacknowledged terminal scene. The React owner keeps its
    // semantic session-opening surface visible and may retry; exposing this DOM
    // would turn a timeout back into the raw/blank/partial frame sequence that
    // staging exists to prevent.
    // Do not reject callers merely because one scheduled ACK attempt lost a
    // render/rAF race. Their own bounded wait remains registered so a second
    // ACK already queued by the final parser callback can complete it without
    // forcing React through an avoidable timeout/retry cycle.
    const visibleMount =
      this.debugVisibleMount?.lease === mountLease ? this.debugVisibleMount : null;
    this.markVisibleFrameStage(mountLease, 'frame-unavailable', {
      hasResolvedInitialSnapshot: this.hasResolvedInitialSnapshot,
      queuedWriteCount: this.terminalWriteQueue.length,
    });
    // Deliberately keep `debugVisibleMount`: unlike the success paths below,
    // this attempt ending does not end the open. A retry is expected, and
    // dropping the profiler's mount here made the frame lane go mute for the
    // rest of the open — which is how the paint that eventually happened went
    // unrecorded, leaving the interval that contained it looking like dead air.
    console.log('[DEBUG][agent-session-load] visible frame unavailable:', {
      sessionId: this.sessionId,
      elapsedMs: visibleMount
        ? Math.round((performance.now() - visibleMount.startedAt) * 10) / 10
        : null,
      hasResolvedInitialSnapshot: this.hasResolvedInitialSnapshot,
      initialSnapshotParserDrained: this.initialSnapshotParserDrained,
      queuedWriteCount: this.terminalWriteQueue.length,
      pendingWriteCount: this.pendingWrites.length,
    });
    this.atomicLiveFramePaintGeneration = null;
    this.atomicLiveFramePaintRevision = null;
    return false;
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
          this.noteCanonicalParserDrained(this.outputGeneration, this.outputRevision);
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
  mount(
    mountTarget: HTMLElement,
    targetDims?: { cols: number; rows: number },
    options: MountFrameOptions = {}
  ): number {
    this.clearVisibleFrameVisibilityListener();
    const mountLease = ++this.mountGeneration;
    const visibleMount = mountTarget !== ensureXtermHost();
    const autoAcknowledgeFrame = options.autoAcknowledgeFrame ?? true;
    this.mountAutoAcknowledgeFrame =
      typeof autoAcknowledgeFrame === 'function'
        ? autoAcknowledgeFrame
        : () => autoAcknowledgeFrame;
    const allowAtomicLiveFrame = options.allowAtomicLiveFrame ?? false;
    this.mountAllowAtomicLiveFrame =
      typeof allowAtomicLiveFrame === 'function'
        ? allowAtomicLiveFrame
        : () => allowAtomicLiveFrame;
    if (visibleMount) {
      this.debugVisibleMount = { lease: mountLease, startedAt: performance.now() };
      this.markVisibleFrameStage(mountLease, 'frame-mount', {
        hasResolvedInitialSnapshot: this.hasResolvedInitialSnapshot,
        suspendedWriteCount: this.suspendedWrites.length,
      });
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
    this.invalidateVisibleFrame({ hide: false });
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
    this.clearVisibleFrameVisibilityListener();
    this.invalidateVisibleFrame({ hide: false });
    this.mountGeneration += 1;
    this.replayToken += 1;
    this.visibleFrameSettlementPending = false;
    this.mountAutoAcknowledgeFrame = null;
    this.mountAllowAtomicLiveFrame = null;
    this.atomicLiveFramePaintGeneration = null;
    this.atomicLiveFramePaintRevision = null;
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
  dispose(options?: { checkpoint?: boolean }): void {
    void this.disposeAndWait(options);
  }

  /**
   * Dispose and wait until main has atomically accepted the checkpoint and
   * released this consumer. Renderer LRU uses this as a reopen barrier so a
   * rapid fifth-task round trip cannot subscribe to the raw ring in the small
   * IPC window before its canonical checkpoint arrives.
   */
  disposeAndWait(options?: { checkpoint?: boolean }): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    const promise = this.disposeOnce(options);
    this.disposePromise = promise;
    return promise;
  }

  private async disposeOnce(options?: { checkpoint?: boolean }): Promise<void> {
    if (this.isDisposed || this.isDisposing) return;
    this.isDisposing = true;
    this.clearVisibleFrameVisibilityListener();
    this.releaseCanonicalRevealClaim();
    const connectedConsumerId = this.connectedConsumerId;
    const shouldCheckpoint = Boolean(options?.checkpoint && this.hasRecoverableSnapshot);
    let checkpoint: PtyRenderCheckpoint | null = null;
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
    // Stop accepting IPC first, then let every batch that already crossed the
    // renderer boundary finish parsing and ACK its exact sequence. This makes
    // an actively-writing hidden terminal evictable without dropping the tail
    // or serializing a half-parsed xterm buffer. Main retains all later bytes
    // after the detached consumer watermark.
    this.offData?.();
    this.offData = null;
    for (const resolve of this.outputActivityWaiters) resolve();
    this.outputActivityWaiters.clear();
    for (const resolve of this.terminalRenderWaiters) resolve();
    this.terminalRenderWaiters.clear();
    for (const resolve of this.visibleFrameWaiters) resolve(false);
    this.visibleFrameWaiters.clear();
    this.publishVisibleFrameState(false);
    this.visibleFrameStateListeners.clear();
    this.visibleFrameMountGeneration = 0;
    this.scrollDisposable.dispose();
    this.renderDisposable.dispose();

    if (shouldCheckpoint) {
      const writesDrained = await withTimeout(
        this.waitForTerminalWrites(),
        PTY_CONSUMER_RELEASE_TIMEOUT_MS
      ).then(
        () => true,
        () => false
      );
      if (writesDrained) {
        try {
          checkpoint = await serializeCheckpointWhenIdle(() => this.createRenderCheckpoint());
        } catch (error) {
          // Eviction must still release the main-process consumer even if a
          // renderer/addon bug prevents serialization. The caller's barrier
          // falls back to a fresh PTY snapshot instead of leaking the lease.
          log.warn('[pty-renderer] failed to create render checkpoint', {
            sessionId: this.sessionId,
            error,
          });
        }
      } else {
        log.warn('[pty-renderer] parser did not drain before eviction checkpoint', {
          sessionId: this.sessionId,
        });
      }
    }

    this.isDisposed = true;
    this.isDisposing = false;
    this.renderingSuspended = true;
    this.suspendedWrites = [];
    this.terminalWriteQueue = [];
    this.terminalWriteActive = false;
    for (const resolve of this.terminalWriteWaiters) resolve();
    this.terminalWriteWaiters.clear();
    this.connectedConsumerId = null;
    let consumerRelease: Promise<unknown> = Promise.resolve();
    if (connectedConsumerId) {
      if (checkpoint) {
        console.log('[DEBUG][agent-session-load] compact checkpoint captured:', {
          sessionId: this.sessionId,
          generation: checkpoint.generation,
          sequence: checkpoint.sequence,
          checkpointCharacters: checkpoint.buffer.length,
          cols: checkpoint.cols,
          rows: checkpoint.rows,
        });
        consumerRelease = withTimeout(
          rpc.pty.checkpointAndUnsubscribe(this.sessionId, connectedConsumerId, checkpoint),
          PTY_CONSUMER_RELEASE_TIMEOUT_MS
        ).catch(() =>
          withTimeout(
            rpc.pty.unsubscribe(this.sessionId, connectedConsumerId),
            PTY_CONSUMER_RELEASE_TIMEOUT_MS
          ).catch(() => {})
        );
      } else {
        consumerRelease = withTimeout(
          rpc.pty.unsubscribe(this.sessionId, connectedConsumerId),
          PTY_CONSUMER_RELEASE_TIMEOUT_MS
        ).catch(() => {});
      }
    }
    try {
      this.terminal.dispose();
    } catch {}
    try {
      this.ownedContainer.remove();
    } catch {}
    await consumerRelease;
  }

  private createRenderCheckpoint(): PtyRenderCheckpoint | null {
    if (
      !this.connectedConsumerId ||
      !this.hasResolvedInitialSnapshot ||
      !this.initialSnapshotParserDrained ||
      this.terminalWriteActive ||
      this.terminalWriteQueue.length > 0 ||
      this.pendingWrites.length > 0 ||
      this.suspendedWrites.length > 0
    ) {
      return null;
    }
    const configuredScrollback = normalizeTerminalScrollbackLines(this.terminal.options.scrollback);
    const checkpointScrollbackCapacity = Math.min(
      PTY_RENDER_CHECKPOINT_SCROLLBACK_LINES,
      configuredScrollback
    );
    let scrollback = Math.min(checkpointScrollbackCapacity, this.terminal.buffer.active.baseY);
    let buffer = this.serializeAddon.serialize({ scrollback });
    let byteLength = new TextEncoder().encode(buffer).byteLength;
    // Very wide terminals can make 5,000 lines exceed the checkpoint IPC cap.
    // Reduce only the oldest context; never truncate serialized VT bytes.
    while (byteLength > PTY_RENDER_CHECKPOINT_MAX_BYTES && scrollback > 0) {
      scrollback = Math.max(
        0,
        Math.min(
          scrollback - 1,
          Math.floor((scrollback * PTY_RENDER_CHECKPOINT_MAX_BYTES) / byteLength)
        )
      );
      buffer = this.serializeAddon.serialize({ scrollback });
      byteLength = new TextEncoder().encode(buffer).byteLength;
    }
    return {
      buffer,
      generation: this.acknowledgedGeneration,
      sequence: this.acknowledgedSequence,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      // A viewport can already contain enough text while a DEC synchronized
      // output transaction is only half parsed. That is not a frame boundary:
      // marking it trusted would let an LRU checkpoint reveal the exact
      // partial TUI state we otherwise keep hidden during first-frame staging.
      canonical: !this.synchronizedOutputOpen && this.hasCanonicalViewport(),
      scrollbackLines: checkpointScrollbackCapacity,
    };
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
