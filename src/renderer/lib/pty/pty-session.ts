import { makeAutoObservable, runInAction } from 'mobx';
import type { AppSettings } from '@shared/app-settings';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { withTimeout } from '@shared/result';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_TERMINAL_CACHE_MODE,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_HOT_TERMINAL_LIMIT,
  MIN_HOT_TERMINAL_LIMIT,
  type TerminalCacheMode,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { buildTerminalFontFamily, FrontendPty } from '@renderer/lib/pty/pty';
import { log } from '@renderer/utils/logger';
import { selectTerminalLruEvictions, selectTerminalPressureEvictions } from './terminal-lru';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';
export type PtySessionExecution = 'interactive' | 'command';

export type PtySessionOptions = {
  deferConnection?: boolean;
  execution?: PtySessionExecution;
};

const TERMINAL_SETTINGS_TIMEOUT_MS = 3_000;
const AUTO_PRESSURE_SAMPLE_INTERVAL_MS = 10_000;
const AUTO_MEMORY_PRESSURE_BYTES = 1_500_000_000;
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
      'connectionEnabled' | 'connectionRequested' | 'connectPromise' | 'disposeExitListener'
    >(this, {
      pty: false,
      connectionEnabled: false,
      connectionRequested: false,
      connectPromise: false,
      disposeExitListener: false,
    });
  }

  /**
   * Allow a deferred renderer to connect after its backend PTY exists.
   * A visible terminal may request the connection before backend creation
   * completes; connectionRequested carries that demand across this gate.
   */
  enableConnection(): void {
    this.connectionEnabled = true;
    if (this.connectionRequested && this.status === 'disconnected') {
      void this.connect().catch(() => {});
    }
  }

  async connect(): Promise<void> {
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
      pty = new FrontendPty(this.sessionId);
      this.pty = pty;
      PtySession.touchHotSession(this);
      runInAction(() => {
        this.status = 'connecting';
      });
      log.debug('[pty-session] preparation started', { sessionId: this.sessionId });

      const terminalSettings = await withTimeout(
        rpc.appSettings.get('terminal') as Promise<AppSettings['terminal']>,
        TERMINAL_SETTINGS_TIMEOUT_MS
      ).catch((error: unknown) => {
        log.warn('PtySession: terminal settings unavailable, using defaults', {
          sessionId: this.sessionId,
          error,
        });
        return null;
      });
      PtySession.setHotTerminalPolicy(
        terminalSettings?.hotTerminalMode ?? DEFAULT_TERMINAL_CACHE_MODE,
        terminalSettings?.hotTerminalLimit ?? DEFAULT_HOT_TERMINAL_LIMIT
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

  async reconnect() {
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

  dispose() {
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

  static setHotTerminalPolicy(mode: TerminalCacheMode, limit: number): void {
    PtySession.hotMode = mode;
    PtySession.hotLimit = Math.min(
      MAX_HOT_TERMINAL_LIMIT,
      Math.max(MIN_HOT_TERMINAL_LIMIT, Math.floor(limit))
    );
    if (mode === 'fixed') {
      PtySession.stopAutoPressureMonitor();
      PtySession.enforceHotLimit();
    } else {
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
    if (PtySession.hotMode === 'fixed') {
      PtySession.enforceHotLimit(session.sessionId);
    } else {
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
          electronMemoryBytes >= AUTO_MEMORY_PRESSURE_BYTES
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
        DEFAULT_HOT_TERMINAL_LIMIT
      )
    );
    if (evictions.size === 0) return;
    log.info('[pty-session] adaptive frontend cache eviction', {
      reason,
      count: evictions.size,
      residentRenderers: PtySession.hotSessions.length,
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
    this.connectionRequested = false;
    this.connectPromise = null;
    this.pty?.dispose({ checkpoint: true });
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
  }
}
