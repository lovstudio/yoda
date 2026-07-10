import { makeAutoObservable, observable, runInAction } from 'mobx';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import type { WorkspaceShellAction } from '@shared/workspace-shell';
import { rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';

export class WorkspaceShellStore {
  isOpen = false;
  isStarting = false;
  title = 'Terminal';
  error: string | null = null;
  session: PtySession | null = null;
  private startPromise: Promise<PtySession> | null = null;

  constructor() {
    makeAutoObservable<this, 'startPromise'>(this, {
      session: observable.ref,
      startPromise: false,
    });
  }

  async openShell(): Promise<void> {
    this.isOpen = true;
    this.title = 'Terminal';
    this.error = null;
    try {
      const alreadyStarted = this.session !== null;
      const session = await this.ensureSession();
      if (alreadyStarted) await rpc.workspaceShell.start({ sessionId: session.sessionId });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  }

  async runRuntimeAction(runtimeId: RuntimeId, action: WorkspaceShellAction): Promise<void> {
    this.isOpen = true;
    this.title = getRuntime(runtimeId)?.name ?? runtimeId;
    this.error = null;
    try {
      const session = await this.ensureSession();
      await rpc.workspaceShell.execute(session.sessionId, { runtimeId, action });
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    }
  }

  close(): void {
    this.isOpen = false;
  }

  async reset(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.startPromise = null;
    session?.dispose();
    if (session) await rpc.workspaceShell.stop(session.sessionId);
  }

  private ensureSession(): Promise<PtySession> {
    if (this.session) return Promise.resolve(this.session);
    if (this.startPromise) return this.startPromise;

    const start = this.startSession();
    this.startPromise = start;
    return start.finally(() => {
      if (this.startPromise === start) this.startPromise = null;
    });
  }

  private async startSession(): Promise<PtySession> {
    this.isStarting = true;
    const session = new PtySession(`workspace-shell:${crypto.randomUUID()}`);
    runInAction(() => {
      this.session = session;
    });
    try {
      // Subscribe before the backend starts so even a very fast command cannot
      // emit output before the renderer has installed its listener.
      await session.connect();
      await rpc.workspaceShell.start({ sessionId: session.sessionId });
      return session;
    } catch (error) {
      session.dispose();
      runInAction(() => {
        if (this.session === session) this.session = null;
        this.error = error instanceof Error ? error.message : String(error);
      });
      throw error;
    } finally {
      runInAction(() => {
        this.isStarting = false;
      });
    }
  }
}

export const workspaceShellStore = new WorkspaceShellStore();
