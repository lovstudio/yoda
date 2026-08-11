import { makeAutoObservable, runInAction } from 'mobx';
import type { AppSettings } from '@shared/app-settings';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { withTimeout } from '@shared/result';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_HOT_TERMINAL_LIMIT,
  MIN_HOT_TERMINAL_LIMIT,
} from '@shared/terminal-settings';
import { events, rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { log } from '@renderer/utils/logger';
import { selectTerminalLruEvictions } from './terminal-lru';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';
export type PtySessionExecution = 'interactive' | 'command';

export type PtySessionOptions = {
  deferConnection?: boolean;
  execution?: PtySessionExecution;
};

const TERMINAL_SETTINGS_TIMEOUT_MS = 3_000;

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown frontend PTY preparation error';
}

export class PtySession {
  private static hotLimit = DEFAULT_HOT_TERMINAL_LIMIT;
  private static hotSessions: PtySession[] = [];

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
    if (!this.connectionEnabled) return;
    if (this.connectPromise) return this.connectPromise;
    if (this.pty) {
      PtySession.touchHotSession(this);
      return;
    }

    const promise = this.connectInternal();
    this.connectPromise = promise;
    try {
      await promise;
    } finally {
      if (this.connectPromise === promise) this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<void> {
    let pty: FrontendPty | null = null;
    try {
      pty = new FrontendPty(this.sessionId);
      this.pty = pty;
      PtySession.touchHotSession(this);
      runInAction(() => {
        this.status = 'connecting';
      });

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
      PtySession.setHotTerminalLimit(
        terminalSettings?.hotTerminalLimit ?? DEFAULT_HOT_TERMINAL_LIMIT
      );
      pty.setScrollbackLines(
        terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      );
      if (this.pty !== pty) {
        pty.dispose();
        return;
      }
      runInAction(() => {
        this.status = 'ready';
        this.connectionError = null;
      });
    } catch (error) {
      if (this.pty === pty) {
        pty?.dispose();
        PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
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
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
  }

  static setHotTerminalLimit(limit: number): void {
    PtySession.hotLimit = Math.min(
      MAX_HOT_TERMINAL_LIMIT,
      Math.max(MIN_HOT_TERMINAL_LIMIT, Math.floor(limit))
    );
    PtySession.enforceHotLimit();
  }

  private static touchHotSession(session: PtySession): void {
    PtySession.hotSessions = PtySession.hotSessions.filter((candidate) => candidate !== session);
    PtySession.hotSessions.push(session);
    PtySession.enforceHotLimit(session.sessionId);
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
    this.connectionRequested = false;
    this.connectPromise = null;
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
      this.connectionError = null;
    });
  }
}
