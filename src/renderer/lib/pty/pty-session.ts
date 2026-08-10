import { makeAutoObservable, runInAction } from 'mobx';
import type { AppSettings } from '@shared/app-settings';
import {
  DEFAULT_HOT_TERMINAL_LIMIT,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  MAX_HOT_TERMINAL_LIMIT,
  MIN_HOT_TERMINAL_LIMIT,
} from '@shared/terminal-settings';
import { rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { selectTerminalLruEvictions } from './terminal-lru';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  private static hotLimit = DEFAULT_HOT_TERMINAL_LIMIT;
  private static hotSessions: PtySession[] = [];

  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';
  private connectionEnabled: boolean;
  private connectionRequested = false;
  private connectPromise: Promise<void> | null = null;

  constructor(
    readonly sessionId: string,
    options?: { deferConnection?: boolean }
  ) {
    this.connectionEnabled = !(options?.deferConnection ?? false);
    makeAutoObservable<this, 'connectionEnabled' | 'connectionRequested' | 'connectPromise'>(this, {
      pty: false,
      connectionEnabled: false,
      connectionRequested: false,
      connectPromise: false,
    });
  }

  /**
   * Allow a deferred renderer to connect after its backend PTY exists.
   * A visible terminal may request the connection before backend creation
   * completes; connectionRequested carries that demand across this gate.
   */
  enableConnection(): void {
    this.connectionEnabled = true;
    if (this.connectionRequested && this.status === 'disconnected') void this.connect();
  }

  async connect(): Promise<void> {
    // Connection demand must come from a real terminal surface. This method
    // prepares xterm and its settings only; usePty starts the main-process
    // output subscription after the mounted terminal has real dimensions.
    this.connectionRequested = true;
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
    this.pty = new FrontendPty(this.sessionId);
    const pty = this.pty;
    PtySession.touchHotSession(this);
    runInAction(() => {
      this.status = 'connecting';
    });
    try {
      const terminalSettings = (await rpc.appSettings.get('terminal')) as AppSettings['terminal'];
      PtySession.setHotTerminalLimit(terminalSettings.hotTerminalLimit);
      pty.setScrollbackLines(
        terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      );
    } catch {
      pty.setScrollbackLines(DEFAULT_TERMINAL_SCROLLBACK_LINES);
    }
    if (this.pty !== pty) {
      pty.dispose();
      return;
    }
    runInAction(() => {
      this.status = 'ready';
    });
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
    this.pty?.dispose();
    PtySession.hotSessions = PtySession.hotSessions.filter((session) => session !== this);
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
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
    });
  }
}
