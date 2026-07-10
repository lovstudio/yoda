import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { RuntimeId } from '@shared/runtime-registry';
import type { WorkspaceShellAction } from '@shared/workspace-shell';
import { rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';

export type WorkspaceShellMode = 'shell' | 'runtime-action';

type TerminalSize = { cols: number; rows: number };

export class WorkspaceShellStore {
  isOpen = false;
  isStarting = false;
  error: string | null = null;
  session: PtySession | null = null;
  mode: WorkspaceShellMode = 'shell';
  runtimeId: RuntimeId | null = null;
  runtimeAction: WorkspaceShellAction | null = null;
  cwd: string | undefined;
  private operationVersion = 0;

  constructor() {
    makeAutoObservable<this, 'operationVersion'>(this, {
      session: observable.ref,
      operationVersion: false,
    });
  }

  get isShellOpen(): boolean {
    return this.isOpen && this.mode === 'shell';
  }

  async toggleShell(cwd?: string): Promise<void> {
    if (this.isShellOpen) {
      this.close();
      return;
    }
    await this.openShell(cwd);
  }

  async openShell(cwd?: string, forceRestart = false): Promise<void> {
    const normalizedCwd = cwd?.trim() || undefined;
    if (!forceRestart && this.session && this.mode === 'shell' && this.cwd === normalizedCwd) {
      this.isOpen = true;
      this.error = null;
      return;
    }

    const operation = this.beginOperation('shell', normalizedCwd);
    const previousSize = this.currentSize();
    try {
      const session = await this.replaceSession(operation);
      if (!session) return;
      await rpc.workspaceShell.start({
        sessionId: session.sessionId,
        cwd: normalizedCwd,
        initialSize: this.currentSize() ?? previousSize,
      });
    } catch (error) {
      this.recordError(operation, error);
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  async restartShell(): Promise<void> {
    await this.openShell(this.cwd, true);
  }

  async runRuntimeAction(
    runtimeId: RuntimeId,
    action: WorkspaceShellAction,
    cwd?: string
  ): Promise<void> {
    const normalizedCwd = cwd?.trim() || undefined;
    const operation = this.beginOperation('runtime-action', normalizedCwd, runtimeId, action);
    const previousSize = this.currentSize();
    try {
      // Runtime actions always get a fresh frontend terminal. Reusing an xterm
      // after killing a full-screen Agent TUI leaves alternate-buffer and size
      // state behind, which is the source of the corrupted console rendering.
      const session = await this.replaceSession(operation);
      if (!session) return;
      await rpc.workspaceShell.execute(session.sessionId, {
        runtimeId,
        action,
        cwd: normalizedCwd,
        initialSize: this.currentSize() ?? previousSize,
      });
    } catch (error) {
      this.recordError(operation, error);
      throw error;
    } finally {
      this.finishOperation(operation);
    }
  }

  close(): void {
    this.isOpen = false;
  }

  async reset(): Promise<void> {
    this.operationVersion += 1;
    const session = this.session;
    this.session = null;
    this.isOpen = false;
    this.isStarting = false;
    this.error = null;
    this.mode = 'shell';
    this.runtimeId = null;
    this.runtimeAction = null;
    this.cwd = undefined;
    session?.dispose();
    if (session) await rpc.workspaceShell.stop(session.sessionId);
  }

  private beginOperation(
    mode: WorkspaceShellMode,
    cwd: string | undefined,
    runtimeId: RuntimeId | null = null,
    runtimeAction: WorkspaceShellAction | null = null
  ): number {
    this.operationVersion += 1;
    this.isOpen = true;
    this.isStarting = true;
    this.error = null;
    this.mode = mode;
    this.runtimeId = runtimeId;
    this.runtimeAction = runtimeAction;
    this.cwd = cwd;
    return this.operationVersion;
  }

  private async replaceSession(operation: number): Promise<PtySession | null> {
    const previous = this.session;
    runInAction(() => {
      this.session = null;
    });
    previous?.dispose();
    if (previous) {
      await rpc.workspaceShell.stop(previous.sessionId).catch(() => {});
    }
    if (operation !== this.operationVersion) return null;

    const session = new PtySession(`workspace-shell:${crypto.randomUUID()}`);
    runInAction(() => {
      this.session = session;
    });
    await session.connect();
    if (operation === this.operationVersion) return session;

    session.dispose();
    runInAction(() => {
      if (this.session === session) this.session = null;
    });
    return null;
  }

  private currentSize(): TerminalSize | undefined {
    const dimensions = this.session?.pty?.lastSentDims;
    return dimensions ? { ...dimensions } : undefined;
  }

  private recordError(operation: number, error: unknown): void {
    if (operation !== this.operationVersion) return;
    runInAction(() => {
      this.error = error instanceof Error ? error.message : String(error);
    });
  }

  private finishOperation(operation: number): void {
    if (operation !== this.operationVersion) return;
    runInAction(() => {
      this.isStarting = false;
    });
  }
}

export const workspaceShellStore = new WorkspaceShellStore();
