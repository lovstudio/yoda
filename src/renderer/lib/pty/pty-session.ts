import { makeAutoObservable, runInAction } from 'mobx';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { withTimeout } from '@shared/result';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_TERMINAL_CACHE_MODE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_HOT_TERMINAL_LIMIT,
  MIN_HOT_TERMINAL_LIMIT,
  resolveAutoTerminalCachePolicy,
  type AutoTerminalCachePolicy,
  type TerminalCacheCapacity,
  type TerminalCacheMode,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { buildTerminalFontFamily, FrontendPty } from '@renderer/lib/pty/pty';
import { log } from '@renderer/utils/logger';
import { loadMachineCapacity } from './machine-capacity';
import { selectTerminalLruEvictions, selectTerminalPressureEvictions } from './terminal-lru';
import { loadTerminalSettings } from './terminal-settings-cache';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';
export type PtySessionExecution = 'interactive' | 'command';

export type PtySessionOptions = {
  deferConnection?: boolean;
  execution?: PtySessionExecution;
};

const TERMINAL_SETTINGS_TIMEOUT_MS = 3_000;
const AUTO_PRESSURE_SAMPLE_INTERVAL_MS = 10_000;
const AUTO_HIDDEN_OUTPUT_CODE_UNITS_PER_SECOND = 2_000_000;
const AUTO_MEMORY_PRESSURE_SAMPLES = 2;
const AUTO_OUTPUT_PRESSURE_SAMPLES = 3;
const AUTO_PRESSURE_MIN_TERMINALS = 3;

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown frontend PTY preparation error';
}

export class PtySession {
  private static hotMode: TerminalCacheMode = DEFAULT_TERMINAL_CACHE_MODE;
  private static hotLimit = DEFAULT_HOT_TERMINAL_LIMIT;
  private static autoPolicy: AutoTerminalCachePolicy = resolveAutoTerminalCachePolicy();
  private static hotSessions: PtySession[] = [];
  private static autoPressureTimer: ReturnType<typeof setInterval> | null = null;
  private static autoPressureSampleInFlight = false;
  private static memoryPressureSamples = 0;
  private static outputPressureSamples = 0;
  private static lastOutputSampleAt = performance.now();

  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  connectionError: string | null = null;
  hasExited = false;
  private connectionEnabled: boolean;
  private connectionRequested = false;
  private connectPromise: Promise<void> | null = null;
  private evictionBarrier: Promise<void> | null = null;
  private disposed = false;
  private readonly disposeExitListener: (() => void) | null;

  constructor(
    readonly sessionId: string,
    readonly options: PtySessionOptions = {}
  ) {
    this.connectionEnabled = !(options.deferConnection ?? false);
    this.disposeExitListener =
      options.execution === 'command'
        ? events.on(
            ptyExitChannel,
            () => {
              runInAction(() => {
                this.hasExited = true;
              });
            },
            sessionId
          )
        : null;
    makeAutoObservable<
      this,
      | 'connectionEnabled'
      | 'connectionRequested'
      | 'connectPromise'
      | 'evictionBarrier'
      | 'disposed'
      | 'disposeExitListener'
    >(this, {
      pty: false,
      connectionEnabled: false,
      connectionRequested: false,
      connectPromise: false,
      evictionBarrier: false,
      disposed: false,
      disposeExitListener: false,
    });
  }

  /**
   * Allow a deferred renderer to connect after its backend PTY exists.
   * A visible terminal may request the connection before backend creation
   * completes; connectionRequested carries that demand across this gate.
   */
  enableConnection(): void {
    if (this.disposed) return;
    this.connectionEnabled = true;
    if (this.connectionRequested && this.status === 'disconnected') {
      void this.connect().catch(() => {});
    }
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    // Connection demand must come from a real terminal surface. This method
    // prepares xterm and its settings only; usePty starts the main-process
    // output subscription after the mounted terminal has real dimensions.
    this.connectionRequested = true;
    runInAction(() => {
      this.connectionError = null;
    });
    if (!this.connectionEnabled) {
      log.debug('[pty-session] connection deferred', { sessionId: this.sessionId });
      return;
    }
    if (this.connectPromise) return this.connectPromise;
    if (this.pty) {
      PtySession.touchHotSession(this);
      return;
    }

    const preparationStartedAt = performance.now();
    console.log('[DEBUG][agent-session-load] frontend preparation requested:', {
      sessionId: this.sessionId,
    });
    log.debug('[pty-session] preparation requested', { sessionId: this.sessionId });
    const promise = this.connectInternal(preparationStartedAt);
    this.connectPromise = promise;
    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) this.connectPromise = null;
    }
  }

  private async connectInternal(preparationStartedAt: number): Promise<void> {
    let pty: FrontendPty | null = null;
    try {
      if (this.evictionBarrier) await this.evictionBarrier;
      if (this.disposed || !this.connectionRequested) return;
      pty = new FrontendPty(this.sessionId, undefined, {
        onConnectionError: (error) => this.handleFrontendConnectionError(pty, error),
      });
      this.pty = pty;
      PtySession.touchHotSession(this);
      runInAction(() => {
        this.status = 'connecting';
      });
      log.debug('[pty-session] preparation started', { sessionId: this.sessionId });

      const terminalSettings = await withTimeout(
        loadTerminalSettings(),
        TERMINAL_SETTINGS_TIMEOUT_MS
      ).catch((error: unknown) => {
        log.warn('PtySession: terminal settings unavailable, using defaults', {
          sessionId: this.sessionId,
          error,
        });
        return null;
      });
      // Auto mode sizes itself from the machine, so the capacity probe belongs on
      // the same path as the settings it feeds. Both are cached per renderer.
      const machineCapacity = await loadMachineCapacity();
      PtySession.setHotTerminalPolicy(
        terminalSettings?.hotTerminalMode ?? DEFAULT_TERMINAL_CACHE_MODE,
        terminalSettings?.hotTerminalLimit ?? DEFAULT_HOT_TERMINAL_LIMIT,
        machineCapacity
      );
      pty.setScrollbackLines(
        terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      );
      const customFontFamily = terminalSettings?.fontFamily?.trim();
      if (customFontFamily) {
        pty.terminal.options.fontFamily = buildTerminalFontFamily(customFontFamily);
      }
      if (this.pty !== pty) {
        pty.dispose();
        return;
      }
      runInAction(() => {
        this.status = 'ready';
        this.connectionError = null;
      });
      console.log('[DEBUG][agent-session-load] frontend preparation ready:', {
        sessionId: this.sessionId,
        elapsedMs: Math.round((performance.now() - preparationStartedAt) * 10) / 10,
      });
      log.debug('[pty-session] preparation ready', { sessionId: this.sessionId });
    } catch (error) {
      if (this.pty === pty) {
        pty?.dispose();
        PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
        PtySession.refreshAutoPressureMonitor();
        runInAction(() => {
          this.pty = null;
          this.status = 'disconnected';
          this.connectionError = getConnectionErrorMessage(error);
        });
      } else {
        pty?.dispose();
      }
      log.warn('PtySession: failed to prepare frontend PTY', {
        sessionId: this.sessionId,
        error,
      });
      throw error;
    }
  }

  /**
   * Output subscription starts only after usePty mounts and measures xterm, so
   * failures happen after frontend preparation reached `ready`. Remove the
   * failed renderer and expose the existing retry UI, but keep status stable:
   * ConversationSession's visibility effect keys on status and would otherwise
   * turn a timeout into an unbounded automatic reconnect loop.
   */
  private handleFrontendConnectionError(candidate: FrontendPty | null, error: unknown): void {
    if (this.disposed || !candidate || this.pty !== candidate) return;
    candidate.dispose();
    PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
    PtySession.refreshAutoPressureMonitor();
    runInAction(() => {
      if (this.pty === candidate) this.pty = null;
      this.connectionError = getConnectionErrorMessage(error);
    });
    log.warn('PtySession: frontend PTY output subscription failed', {
      sessionId: this.sessionId,
      error,
    });
  }

  /**
   * Surface a bounded canonical-frame failure without destroying the live PTY.
   * The retry action clears this through connect(), while output can keep
   * parsing in the background for diagnostics and a subsequent retry.
   */
  reportConnectionError(error: unknown): void {
    if (this.disposed) return;
    runInAction(() => {
      this.connectionError = getConnectionErrorMessage(error);
    });
  }

  async reconnect() {
    if (this.disposed) return;
    // Carry the last known size forward: the new FrontendPty starts with
    // lastSentDims=null, and the post-mount resize broadcast can be deduped when
    // the pane size is unchanged. Without seeding, a subsequent restart would
    // read null and spawn the backend PTY at the 80x24 fallback (half-height TUI).
    const carriedDims = this.pty?.lastSentDims ?? null;
    log.debug('[pty-session] reconnect requested', {
      sessionId: this.sessionId,
      carriedDims,
    });
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
    this.connectionEnabled = true;
    await this.connect();
    if (carriedDims && this.pty) {
      this.pty.lastSentDims = carriedDims;
    }
  }

  /**
   * Stage this session's terminal protocol into the shared off-screen host.
   * Explicit task navigation uses this to wait for a canonical live frame
   * without exposing xterm's transcript/replay/parser intermediate states.
   */
  async prepareFirstFrame(
    targetDims: { cols: number; rows: number } | undefined,
    shouldContinue: () => boolean,
    options: { waitForCanonicalOutput?: boolean; timeoutMs?: number } = {}
  ): Promise<boolean> {
    await this.connect();
    const pty = this.pty;
    if (!pty || this.status !== 'ready' || !shouldContinue()) return false;
    PtySession.touchHotSession(this);
    return pty.prepareFirstFrame(
      targetDims ?? pty.lastSentDims ?? undefined,
      shouldContinue,
      options
    );
  }

  /** Roll back a renderer created for a navigation request cancelled before subscription. */
  discardUnconnectedRenderer(candidate: FrontendPty): void {
    if (this.pty !== candidate || candidate.mounted || candidate.hasRecoverableSnapshot) {
      return;
    }
    candidate.dispose();
    PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
    PtySession.refreshAutoPressureMonitor();
    runInAction(() => {
      if (this.pty === candidate) this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionRequested = false;
    this.connectPromise = null;
    this.disposeExitListener?.();
    this.pty?.dispose();
    PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
    PtySession.refreshAutoPressureMonitor();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
  }

  static setHotTerminalPolicy(
    mode: TerminalCacheMode,
    limit: number,
    capacity?: TerminalCacheCapacity | null
  ): void {
    if (capacity) PtySession.autoPolicy = resolveAutoTerminalCachePolicy(capacity);
    PtySession.hotMode = mode;
    PtySession.hotLimit =
      mode === 'auto'
        ? PtySession.autoPolicy.limit
        : Math.min(MAX_HOT_TERMINAL_LIMIT, Math.max(MIN_HOT_TERMINAL_LIMIT, Math.floor(limit)));
    const protectedSessionId = PtySession.hotSessions.at(-1)?.sessionId;
    if (mode === 'fixed') {
      PtySession.stopAutoPressureMonitor();
      PtySession.enforceHotLimit(protectedSessionId);
    } else {
      PtySession.enforceHotLimit(protectedSessionId);
      PtySession.ensureAutoPressureMonitor();
    }
  }

  /** Compatibility entrypoint for callers intentionally selecting a fixed limit. */
  static setHotTerminalLimit(limit: number): void {
    PtySession.setHotTerminalPolicy('fixed', limit);
  }

  private static touchHotSession(session: PtySession): void {
    PtySession.hotSessions = PtySession.hotSessions.filter((candidate) => candidate !== session);
    PtySession.hotSessions.push(session);
    PtySession.enforceHotLimit(session.sessionId);
    if (PtySession.hotMode === 'auto') {
      PtySession.ensureAutoPressureMonitor();
    }
  }

  private static ensureAutoPressureMonitor(): void {
    if (
      PtySession.hotMode !== 'auto' ||
      PtySession.hotSessions.length < AUTO_PRESSURE_MIN_TERMINALS ||
      PtySession.autoPressureTimer !== null
    ) {
      return;
    }
    PtySession.lastOutputSampleAt = performance.now();
    PtySession.autoPressureTimer = setInterval(() => {
      void PtySession.sampleAutoPressure();
    }, AUTO_PRESSURE_SAMPLE_INTERVAL_MS);
    (PtySession.autoPressureTimer as unknown as { unref?: () => void }).unref?.();
  }

  private static refreshAutoPressureMonitor(): void {
    if (
      PtySession.hotMode !== 'auto' ||
      PtySession.hotSessions.length < AUTO_PRESSURE_MIN_TERMINALS
    ) {
      PtySession.stopAutoPressureMonitor();
      return;
    }
    PtySession.ensureAutoPressureMonitor();
  }

  private static stopAutoPressureMonitor(): void {
    if (PtySession.autoPressureTimer !== null) {
      clearInterval(PtySession.autoPressureTimer);
      PtySession.autoPressureTimer = null;
    }
    PtySession.autoPressureSampleInFlight = false;
    PtySession.memoryPressureSamples = 0;
    PtySession.outputPressureSamples = 0;
  }

  private static async sampleAutoPressure(): Promise<void> {
    if (
      PtySession.hotMode !== 'auto' ||
      PtySession.hotSessions.length < AUTO_PRESSURE_MIN_TERMINALS ||
      PtySession.autoPressureSampleInFlight
    ) {
      return;
    }
    PtySession.autoPressureSampleInFlight = true;
    try {
      // A renderer that was protected while its first snapshot was in flight
      // may now be recoverable. Re-apply the normal bound without waiting for
      // memory or output pressure to grant eviction permission.
      PtySession.enforceHotLimit(PtySession.hotSessions.at(-1)?.sessionId);

      const now = performance.now();
      const elapsedSeconds = Math.max(0.001, (now - PtySession.lastOutputSampleAt) / 1_000);
      PtySession.lastOutputSampleAt = now;
      const hiddenOutputCodeUnits = PtySession.hotSessions.reduce(
        (total, session) => total + (session.pty?.takeHiddenOutputCodeUnits() ?? 0),
        0
      );
      const hiddenOutputRate = hiddenOutputCodeUnits / elapsedSeconds;
      PtySession.outputPressureSamples =
        hiddenOutputRate >= AUTO_HIDDEN_OUTPUT_CODE_UNITS_PER_SECOND
          ? PtySession.outputPressureSamples + 1
          : 0;

      try {
        const snapshot = await rpc.app.getResourceSnapshot();
        // Match the warm-window precedent: pressure is the Electron working
        // set only. External Agent/tmux process memory must not evict xterm
        // caches merely because the user intentionally runs many sessions.
        const electronMemoryBytes = snapshot.processes.reduce(
          (total, process) => total + process.memoryBytes,
          0
        );
        PtySession.memoryPressureSamples =
          electronMemoryBytes >= PtySession.autoPolicy.memoryPressureBytes
            ? PtySession.memoryPressureSamples + 1
            : 0;
      } catch (error) {
        // Unknown memory state is protection, never permission to evict.
        PtySession.memoryPressureSamples = 0;
        log.debug('[pty-session] adaptive cache pressure sample unavailable', { error });
      }

      if (
        PtySession.hotMode !== 'auto' ||
        PtySession.hotSessions.length < AUTO_PRESSURE_MIN_TERMINALS
      ) {
        return;
      }

      const reason =
        PtySession.memoryPressureSamples >= AUTO_MEMORY_PRESSURE_SAMPLES
          ? 'memory'
          : PtySession.outputPressureSamples >= AUTO_OUTPUT_PRESSURE_SAMPLES
            ? 'sustained-output'
            : null;
      if (!reason) return;
      PtySession.evictUnderPressure(reason, hiddenOutputRate);
      PtySession.memoryPressureSamples = 0;
      PtySession.outputPressureSamples = 0;
    } finally {
      PtySession.autoPressureSampleInFlight = false;
    }
  }

  private static evictUnderPressure(
    reason: 'memory' | 'sustained-output',
    hiddenOutputRate: number
  ): void {
    const protectedSessionId = PtySession.hotSessions.at(-1)?.sessionId;
    const evictions = new Set(
      selectTerminalPressureEvictions(
        PtySession.hotSessions.map((session) => ({
          sessionId: session.sessionId,
          mounted: session.pty?.mounted ?? false,
          connecting: session.status === 'connecting',
          recoverable: session.pty?.hasRecoverableSnapshot ?? false,
        })),
        protectedSessionId,
        MIN_HOT_TERMINAL_LIMIT
      )
    );
    if (evictions.size === 0) return;
    log.info('[pty-session] adaptive frontend cache eviction', {
      reason,
      count: evictions.size,
      residentRenderers: PtySession.hotSessions.length,
      hotLimit: PtySession.hotLimit,
      memoryPressureBytes: PtySession.autoPolicy.memoryPressureBytes,
      hiddenOutputCodeUnitsPerSecond: Math.round(hiddenOutputRate),
    });
    for (const session of PtySession.hotSessions) {
      if (evictions.has(session.sessionId)) session.evictRenderer();
    }
    PtySession.hotSessions = PtySession.hotSessions.filter(
      (session) => !evictions.has(session.sessionId)
    );
    PtySession.refreshAutoPressureMonitor();
  }

  private static enforceHotLimit(protectedSessionId?: string): void {
    const evictions = new Set(
      selectTerminalLruEvictions(
        PtySession.hotSessions.map((session) => ({
          sessionId: session.sessionId,
          mounted: session.pty?.mounted ?? false,
          connecting: session.status === 'connecting',
          recoverable: session.pty?.hasRecoverableSnapshot ?? false,
        })),
        PtySession.hotLimit,
        protectedSessionId
      )
    );
    if (evictions.size === 0) return;
    for (const session of PtySession.hotSessions) {
      if (evictions.has(session.sessionId)) session.evictRenderer();
    }
    PtySession.hotSessions = PtySession.hotSessions.filter(
      (session) => !evictions.has(session.sessionId)
    );
  }

  private evictRenderer(): void {
    if (this.pty?.mounted) return;
    log.debug('[pty-session] frontend renderer cache evicted', { sessionId: this.sessionId });
    const evictedPty = this.pty;
    this.connectionRequested = false;
    this.connectPromise = null;
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
    if (evictedPty) {
      const barrier = evictedPty.disposeAndWait({ checkpoint: true }).catch((error) => {
        log.warn('[pty-session] renderer eviction checkpoint failed', {
          sessionId: this.sessionId,
          error,
        });
      });
      const tracked = barrier.finally(() => {
        if (this.evictionBarrier === tracked) this.evictionBarrier = null;
      });
      this.evictionBarrier = tracked;
    }
  }
}
