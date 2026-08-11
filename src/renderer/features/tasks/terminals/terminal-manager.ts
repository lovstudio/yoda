import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { rpc } from '@renderer/lib/ipc';
import { PtySession, type PtySessionExecution } from '@renderer/lib/pty/pty-session';
import { log } from '@renderer/utils/logger';
import { nextTerminalName } from './terminal-tabs';

export type TerminalManagerGateway = {
  getTerminals(projectId: string, taskId: string): Promise<Terminal[]>;
  createTerminal(params: CreateTerminalParams): Promise<Terminal>;
  deleteTerminal(params: { projectId: string; taskId: string; terminalId: string }): Promise<void>;
  renameTerminal(terminalId: string, name: string): Promise<void>;
};

const taskTerminalGateway: TerminalManagerGateway = {
  getTerminals: (projectId, taskId) => rpc.terminals.getTerminalsForTask(projectId, taskId),
  createTerminal: (params) => rpc.terminals.createTerminal(params),
  deleteTerminal: (params) => rpc.terminals.deleteTerminal(params),
  renameTerminal: (terminalId, name) => rpc.terminals.renameTerminal(terminalId, name),
};

export const workspaceTerminalGateway: TerminalManagerGateway = {
  getTerminals: (projectId, taskId) => rpc.terminals.getWorkspaceTerminals(projectId, taskId),
  createTerminal: (params) => rpc.terminals.createWorkspaceTerminal(params),
  deleteTerminal: (params) => rpc.terminals.deleteWorkspaceTerminal(params),
  renameTerminal: async (terminalId, name) => {
    await rpc.terminals.renameWorkspaceTerminal(terminalId, name);
  },
};

function nextCommandTerminalName(label: string, names: string[]): string {
  const base = label.trim();
  if (!base) return nextTerminalName(names);
  const taken = new Set(names);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

export class TerminalManagerStore {
  readonly projectId: string;
  readonly taskId: string;
  private _loaded = false;
  private _loadPromise: Promise<void> | null = null;
  private _ensureDefaultPromise: Promise<Terminal> | null = null;
  private _disposed = false;
  private _generation = 0;
  private readonly _pendingDeletionStores = new Set<TerminalStore>();
  private readonly _disposeObservation: () => void;
  terminals = observable.map<string, TerminalStore>();

  constructor(
    projectId: string,
    taskId: string,
    private readonly gateway: TerminalManagerGateway = taskTerminalGateway
  ) {
    this.projectId = projectId;
    this.taskId = taskId;
    makeObservable(this, {
      terminals: observable,
    });
    this._disposeObservation = onBecomeObserved(this, 'terminals', () => {
      if (this._loaded || this._disposed) return;
      void this.load().catch((error) => {
        if (!this._disposed) {
          log.error('TerminalManagerStore: failed to load terminals', error);
        }
      });
    });
  }

  async load(): Promise<void> {
    if (this._disposed) return;
    if (this._loadPromise) return this._loadPromise;
    if (this._loaded) return;
    const generation = this._generation;
    this._loaded = true;
    const loadPromise = this.gateway
      .getTerminals(this.projectId, this.taskId)
      .then((terminals) => {
        if (!this.isCurrentGeneration(generation)) return;
        runInAction(() => {
          for (const terminal of terminals) {
            // A terminal may have been created locally while this snapshot was
            // in flight. Keep that store (and its deferred PtySession) so the
            // matching create response can finish the optimistic lifecycle.
            if (this.terminals.has(terminal.id)) continue;
            const store = new TerminalStore(terminal);
            this.terminals.set(terminal.id, store);
          }
        });
      })
      .catch((error) => {
        if (this.isCurrentGeneration(generation)) this._loaded = false;
        throw error;
      })
      .finally(() => {
        if (this._loadPromise === loadPromise) this._loadPromise = null;
      });
    this._loadPromise = loadPromise;
    return loadPromise;
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    const generation = this.requireActiveGeneration();
    const optimistic: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
    };

    let store!: TerminalStore;
    let ownsOptimisticStore = false;
    runInAction(() => {
      const existing = this.terminals.get(params.id);
      if (existing) {
        store = existing;
        return;
      }
      store = new TerminalStore(optimistic, {
        deferConnection: true,
        execution: params.command ? 'command' : 'interactive',
      });
      ownsOptimisticStore = true;
      this.terminals.set(params.id, store);
    });

    try {
      const terminal = await this.gateway.createTerminal(params);
      if (!this.isCurrentGeneration(generation)) {
        await this.cleanupLateCreatedTerminal(terminal);
        return terminal;
      }
      if (this.terminals.get(params.id) !== store) {
        // The optimistic terminal was deleted while creation was still in
        // flight. Its earlier delete may have reached main before create was
        // persisted, so delete the late backend result again (idempotently).
        await this.cleanupLateCreatedTerminal(terminal);
        return terminal;
      }
      runInAction(() => {
        Object.assign(store.data, terminal);
        store.session.enableConnection();
      });
      return terminal;
    } catch (err) {
      if (this.isCurrentGeneration(generation) && ownsOptimisticStore) {
        runInAction(() => {
          if (this.terminals.get(params.id) === store) {
            this.terminals.delete(params.id);
          }
        });
        if (!this._pendingDeletionStores.has(store)) store.dispose();
      }
      throw err;
    }
  }

  async createDefaultTerminal(): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((t) => t.data.name);
    const name = nextTerminalName(names);
    const id = crypto.randomUUID();
    return this.createTerminal({ id, projectId: this.projectId, taskId: this.taskId, name });
  }

  /**
   * Ensures an empty terminal surface gets one default terminal. Unlike the
   * explicit "new terminal" action, concurrent callers share one attempt and a
   * failed backend request is not retried until another user/lifecycle action
   * asks again.
   */
  ensureDefaultTerminal(): Promise<Terminal> {
    if (this._ensureDefaultPromise) return this._ensureDefaultPromise;
    if (this._disposed) return Promise.reject(new Error('Terminal manager has been disposed.'));
    const generation = this.requireActiveGeneration();
    const operation = (async () => {
      await this.load();
      if (!this.isCurrentGeneration(generation)) {
        throw new Error('Terminal manager has been disposed.');
      }
      const existing = this.terminals.values().next().value as TerminalStore | undefined;
      if (existing) return existing.data;
      return this.createDefaultTerminal();
    })().finally(() => {
      if (this._ensureDefaultPromise === operation) {
        this._ensureDefaultPromise = null;
      }
    });
    this._ensureDefaultPromise = operation;
    return operation;
  }

  async createNamedTerminal({
    id,
    label,
    initialSize,
  }: {
    id?: string;
    label: string;
    initialSize?: { cols: number; rows: number };
  }): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((terminal) => terminal.data.name);
    return this.createTerminal({
      id: id ?? crypto.randomUUID(),
      projectId: this.projectId,
      taskId: this.taskId,
      name: nextCommandTerminalName(label, names),
      initialSize,
    });
  }

  async createCommandTerminal({
    id,
    command,
    label,
    initialSize,
  }: {
    id?: string;
    command: string;
    label: string;
    initialSize?: { cols: number; rows: number };
  }): Promise<Terminal> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error('Terminal command is empty.');

    const terminal = await this.createNamedTerminal({
      id,
      label,
      initialSize,
    });
    const inputResult = await rpc.pty.sendInput(
      makePtySessionId(this.projectId, this.taskId, terminal.id),
      `${normalizedCommand}\r`
    );
    if (!inputResult.success) {
      throw new Error(`Terminal rejected the launch command: ${inputResult.error.type}`);
    }
    return terminal;
  }

  async createOneShotCommandTerminal({
    id,
    command,
    label,
    initialSize,
  }: {
    id?: string;
    command: string;
    label: string;
    initialSize?: { cols: number; rows: number };
  }): Promise<Terminal> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error('Terminal command is empty.');

    const names = Array.from(this.terminals.values()).map((terminal) => terminal.data.name);
    return this.createTerminal({
      id: id ?? crypto.randomUUID(),
      projectId: this.projectId,
      taskId: this.taskId,
      name: nextCommandTerminalName(label, names),
      initialSize,
      command: normalizedCommand,
      persist: false,
    });
  }

  isCommandTerminalRunning(terminalId: string): boolean {
    const store = this.terminals.get(terminalId);
    return store?.execution === 'command' && !store.session.hasExited;
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    if (this._disposed) return;
    const store = this.terminals.get(terminalId);
    if (!store) return;
    const generation = this._generation;

    runInAction(() => {
      this.terminals.delete(terminalId);
    });
    this._pendingDeletionStores.add(store);

    try {
      await this.gateway.deleteTerminal({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      this._pendingDeletionStores.delete(store);
      if (this.isCurrentGeneration(generation)) {
        const driftedStore = this.terminals.get(terminalId);
        if (driftedStore) {
          runInAction(() => {
            if (this.terminals.get(terminalId) === driftedStore) {
              this.terminals.delete(terminalId);
            }
          });
          driftedStore.dispose();
        }
      }
      store.dispose();
    } catch (err) {
      this._pendingDeletionStores.delete(store);
      if (this.isCurrentGeneration(generation) && !this.terminals.has(terminalId)) {
        runInAction(() => {
          this.terminals.set(terminalId, store);
        });
      } else {
        store.dispose();
      }
      throw err;
    }
  }

  async renameTerminal(terminalId: string, name: string): Promise<void> {
    if (this._disposed) return;
    const store = this.terminals.get(terminalId);
    if (!store) return;
    const generation = this._generation;

    const previousName = store.data.name;

    runInAction(() => {
      store.data.name = name;
    });

    try {
      await this.gateway.renameTerminal(terminalId, name);
    } catch (err) {
      if (this.isCurrentGeneration(generation) && this.terminals.get(terminalId) === store) {
        runInAction(() => {
          store.data.name = previousName;
        });
      }
      throw err;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._generation += 1;
    this._disposeObservation();
    this._loadPromise = null;
    this._ensureDefaultPromise = null;

    const stores = new Set([...this.terminals.values(), ...this._pendingDeletionStores]);
    for (const store of stores) store.dispose();
    this._pendingDeletionStores.clear();
    runInAction(() => {
      this.terminals.clear();
    });
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this._disposed && this._generation === generation;
  }

  private requireActiveGeneration(): number {
    if (this._disposed) throw new Error('Terminal manager has been disposed.');
    return this._generation;
  }

  private async cleanupLateCreatedTerminal(terminal: Terminal): Promise<void> {
    try {
      await this.gateway.deleteTerminal({
        projectId: terminal.projectId,
        taskId: terminal.taskId,
        terminalId: terminal.id,
      });
    } catch (error) {
      log.error(
        'TerminalManagerStore: failed to clean up a terminal created after disposal',
        error
      );
    }
  }
}

export class TerminalStore {
  data: Terminal;
  session: PtySession;
  readonly execution: PtySessionExecution;
  private _disposed = false;

  constructor(
    terminal: Terminal,
    options?: { deferConnection?: boolean; execution?: PtySessionExecution }
  ) {
    this.data = terminal;
    this.execution = options?.execution ?? 'interactive';
    this.session = new PtySession(
      makePtySessionId(terminal.projectId, terminal.taskId, terminal.id),
      {
        deferConnection: options?.deferConnection,
        execution: this.execution,
      }
    );
    makeObservable(this, { data: observable, session: observable, execution: false });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.session.dispose();
  }
}
