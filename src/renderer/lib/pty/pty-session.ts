import { makeAutoObservable, onBecomeObserved, runInAction } from 'mobx';
import type { AppSettings } from '@shared/app-settings';
import {
  DEFAULT_TERMINAL_RENDERER,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
} from '@shared/terminal-settings';
import { rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';

export type PtySessionStatus = 'disconnected' | 'connecting' | 'ready';

export class PtySession {
  pty: FrontendPty | null = null;
  status: PtySessionStatus = 'disconnected';

  constructor(readonly sessionId: string) {
    makeAutoObservable(this, {
      pty: false,
    });
    // Safety net: auto-connect the first time any observer reads status.
    // Eager connect in manager store load() is the primary path; this covers edge cases.
    onBecomeObserved(this, 'status', () => {
      if (this.status === 'disconnected') void this.connect();
    });
  }

  async connect() {
    if (this.pty) return;
    this.pty = new FrontendPty(this.sessionId);
    const pty = this.pty;
    runInAction(() => {
      this.status = 'connecting';
    });
    try {
      const terminalSettings = (await rpc.appSettings.get('terminal')) as AppSettings['terminal'];
      pty.setRendererPreference(terminalSettings?.renderer ?? DEFAULT_TERMINAL_RENDERER);
      pty.setScrollbackLines(
        terminalSettings?.scrollbackLines ?? DEFAULT_TERMINAL_SCROLLBACK_LINES
      );
    } catch {
      pty.setRendererPreference(DEFAULT_TERMINAL_RENDERER);
      pty.setScrollbackLines(DEFAULT_TERMINAL_SCROLLBACK_LINES);
    }
    if (this.pty !== pty) return;
    await pty.connect();
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
    await this.connect();
    if (carriedDims && this.pty) {
      this.pty.lastSentDims = carriedDims;
    }
  }

  dispose() {
    this.pty?.dispose();
    runInAction(() => {
      this.pty = null;
      this.status = 'disconnected';
    });
  }
}
