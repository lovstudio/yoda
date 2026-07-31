import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
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
    onBecomeObserved(this, 'terminals', () => {
      if (this._loaded) return;
      void this.load();
    });
  }

  async load() {
    if (this._loadPromise) return this._loadPromise;
    if (this._loaded) return;
    this._loaded = true;
    const loadPromise = this.gateway
      .getTerminals(this.projectId, this.taskId)
      .then((terminals) => {
        runInAction(() => {
          for (const terminal of terminals) {
            const store = new TerminalStore(terminal);
            this.terminals.set(terminal.id, store);
          }
        });
      })
      .catch((error) => {
        this._loaded = false;
        throw error;
      })
      .finally(() => {
        if (this._loadPromise === loadPromise) this._loadPromise = null;
      });
    this._loadPromise = loadPromise;
    return loadPromise;
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    const optimistic: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
    };

    runInAction(() => {
      const store = new TerminalStore(optimistic, { deferConnection: true });
      this.terminals.set(params.id, store);
    });

    try {
      const terminal = await this.gateway.createTerminal(params);
      runInAction(() => {
        const store = this.terminals.get(params.id);
        if (store) {
          Object.assign(store.data, terminal);
          store.session.enableConnection();
        }
      });
      return terminal;
    } catch (err) {
      runInAction(() => {
        this.terminals.get(params.id)?.dispose();
        this.terminals.delete(params.id);
      });
      throw err;
    }
  }

  async createDefaultTerminal(): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((t) => t.data.name);
    const name = nextTerminalName(names);
    const id = crypto.randomUUID();
    return this.createTerminal({ id, projectId: this.projectId, taskId: this.taskId, name });
  }

  async createNamedTerminal({
    label,
    initialSize,
  }: {
    label: string;
    initialSize?: { cols: number; rows: number };
  }): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((terminal) => terminal.data.name);
    return this.createTerminal({
      id: crypto.randomUUID(),
      projectId: this.projectId,
      taskId: this.taskId,
      name: nextCommandTerminalName(label, names),
      initialSize,
    });
  }

  async createCommandTerminal({
    command,
    label,
    initialSize,
  }: {
    command: string;
    label: string;
    initialSize?: { cols: number; rows: number };
  }): Promise<Terminal> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error('Terminal command is empty.');

    const terminal = await this.createNamedTerminal({
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

  async deleteTerminal(terminalId: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;

    runInAction(() => {
      this.terminals.delete(terminalId);
    });

    try {
      await this.gateway.deleteTerminal({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      store.dispose();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, store);
      });
      throw err;
    }
  }

  async renameTerminal(terminalId: string, name: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;

    const previousName = store.data.name;

    runInAction(() => {
      store.data.name = name;
    });

    try {
      await this.gateway.renameTerminal(terminalId, name);
    } catch (err) {
      runInAction(() => {
        store.data.name = previousName;
      });
      throw err;
    }
  }
}

export class TerminalStore {
  data: Terminal;
  session: PtySession;

  constructor(terminal: Terminal, options?: { deferConnection?: boolean }) {
    this.data = terminal;
    this.session = new PtySession(
      makePtySessionId(terminal.projectId, terminal.taskId, terminal.id),
      {
        deferConnection: options?.deferConnection,
      }
    );
    makeObservable(this, { data: observable, session: observable });
  }

  dispose() {
    this.session.dispose();
  }
}
