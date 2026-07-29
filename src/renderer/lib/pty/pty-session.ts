import { makeAutoObservable, runInAction } from 'mobx';
import type { AppSettings } from '@shared/app-settings';
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from '@shared/terminal-settings';
import { rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
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
    if (this.pty) return;

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
    runInAction(() => {
      this.status = 'connecting';
    });
    try {
      const terminalSettings = (await rpc.appSettings.get('terminal')) as AppSettings['terminal'];
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
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }
}
