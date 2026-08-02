import { autorun, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { TerminalManagerStore, TerminalStore } from './terminal-manager';

const mocks = vi.hoisted(() => ({
  getTerminalsForTask: vi.fn<() => Promise<Terminal[]>>(),
  createTerminal: vi.fn<(terminal: CreateTerminalParams) => Promise<Terminal>>(),
  deleteTerminal:
    vi.fn<(params: { projectId: string; taskId: string; terminalId: string }) => Promise<void>>(),
  renameTerminal: vi.fn<(terminalId: string, name: string) => Promise<void>>(),
  sendInput: vi.fn(),
  logError: vi.fn(),
  sessions: [] as Array<{
    sessionId: string;
    options?: { deferConnection?: boolean };
    connect: ReturnType<typeof vi.fn>;
    enableConnection: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    terminals: {
      getTerminalsForTask: mocks.getTerminalsForTask,
      createTerminal: mocks.createTerminal,
      deleteTerminal: mocks.deleteTerminal,
      renameTerminal: mocks.renameTerminal,
    },
    pty: {
      sendInput: mocks.sendInput,
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    error: mocks.logError,
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    readonly connect = vi.fn();
    readonly enableConnection = vi.fn();
    readonly dispose = vi.fn();

    constructor(
      readonly sessionId: string,
      readonly options?: { deferConnection?: boolean }
    ) {
      mocks.sessions.push(this);
    }
  },
}));

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal 1',
};

describe('TerminalManagerStore terminal lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.length = 0;
    mocks.sendInput.mockResolvedValue({ success: true, data: { queued: false } });
    mocks.deleteTerminal.mockResolvedValue(undefined);
    mocks.renameTerminal.mockResolvedValue(undefined);
  });

  it('loads inactive terminal tabs without eagerly constructing renderer connections', async () => {
    mocks.getTerminalsForTask.mockResolvedValue([terminal]);
    const store = new TerminalManagerStore('project-1', 'task-1');

    await store.load();

    expect(store.terminals.has(terminal.id)).toBe(true);
    expect(mocks.sessions).toHaveLength(1);
    expect(mocks.sessions[0].connect).not.toHaveBeenCalled();
  });

  it('coalesces concurrent loads from observation and explicit opening', async () => {
    let resolveLoad!: (terminals: Terminal[]) => void;
    mocks.getTerminalsForTask.mockReturnValue(
      new Promise<Terminal[]>((resolve) => {
        resolveLoad = resolve;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');

    const first = store.load();
    const second = store.load();
    expect(mocks.getTerminalsForTask).toHaveBeenCalledTimes(1);
    resolveLoad([terminal]);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(store.terminals.has(terminal.id)).toBe(true);
  });

  it('catches a load failure triggered by observation', async () => {
    const error = new Error('load failed');
    mocks.getTerminalsForTask.mockRejectedValue(error);
    const store = new TerminalManagerStore('project-1', 'task-1');

    const stop = autorun(() => store.terminals.size);

    await vi.waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith(
        'TerminalManagerStore: failed to load terminals',
        error
      )
    );
    stop();
    store.dispose();
  });

  it('does not hydrate terminals when a pending load finishes after disposal', async () => {
    let resolveLoad!: (terminals: Terminal[]) => void;
    mocks.getTerminalsForTask.mockReturnValue(
      new Promise<Terminal[]>((resolve) => {
        resolveLoad = resolve;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    const pending = store.load();

    store.dispose();
    resolveLoad([terminal]);
    await pending;

    expect(store.terminals.size).toBe(0);
    expect(mocks.sessions).toHaveLength(0);
  });

  it('coalesces concurrent ensure-default requests into one backend creation', async () => {
    mocks.getTerminalsForTask.mockResolvedValue([]);
    mocks.createTerminal.mockImplementation(async (params) => ({ ...params, ssh: false }));
    const store = new TerminalManagerStore('project-1', 'task-1');

    const [first, second] = await Promise.all([
      store.ensureDefaultTerminal(),
      store.ensureDefaultTerminal(),
    ]);

    expect(mocks.getTerminalsForTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTerminal).toHaveBeenCalledTimes(1);
    expect(first.id).toBe(second.id);
  });

  it('does not retry a failed ensure-default request by itself', async () => {
    mocks.getTerminalsForTask.mockResolvedValue([]);
    mocks.createTerminal.mockRejectedValueOnce(new Error('backend unavailable'));
    const store = new TerminalManagerStore('project-1', 'task-1');

    await expect(store.ensureDefaultTerminal()).rejects.toThrow('backend unavailable');
    await Promise.resolve();

    expect(mocks.createTerminal).toHaveBeenCalledTimes(1);
    expect(store.terminals.size).toBe(0);
  });

  it('keeps an optimistic renderer deferred until the backend terminal exists', async () => {
    let resolveBackend!: (value: Terminal) => void;
    mocks.createTerminal.mockImplementation(
      () =>
        new Promise<Terminal>((resolve) => {
          resolveBackend = resolve;
        })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    const pending = store.createTerminal(terminal);

    expect(mocks.sessions[0].options).toEqual({ deferConnection: true });
    expect(mocks.sessions[0].enableConnection).not.toHaveBeenCalled();

    resolveBackend(terminal);
    await pending;

    expect(mocks.sessions[0].enableConnection).toHaveBeenCalledOnce();
  });

  it('merges a loaded terminal into the same optimistic store while create is in flight', async () => {
    let resolveLoad!: (terminals: Terminal[]) => void;
    let resolveCreate!: (terminal: Terminal) => void;
    mocks.getTerminalsForTask.mockReturnValue(
      new Promise<Terminal[]>((resolve) => {
        resolveLoad = resolve;
      })
    );
    mocks.createTerminal.mockReturnValue(
      new Promise<Terminal>((resolve) => {
        resolveCreate = resolve;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');

    const loading = store.load();
    const creation = store.createTerminal(terminal);
    const optimisticStore = store.terminals.get(terminal.id);
    const optimisticSession = mocks.sessions[0];

    resolveLoad([{ ...terminal, name: 'Loaded terminal' }]);
    await loading;

    expect(store.terminals.get(terminal.id)).toBe(optimisticStore);
    expect(mocks.sessions).toHaveLength(1);
    expect(optimisticSession.dispose).not.toHaveBeenCalled();

    resolveCreate({ ...terminal, name: 'Created terminal' });
    await expect(creation).resolves.toEqual({ ...terminal, name: 'Created terminal' });

    expect(store.terminals.get(terminal.id)).toBe(optimisticStore);
    expect(store.terminals.get(terminal.id)?.data.name).toBe('Created terminal');
    expect(optimisticSession.enableConnection).toHaveBeenCalledOnce();
    expect(optimisticSession.dispose).not.toHaveBeenCalled();
    expect(mocks.deleteTerminal).not.toHaveBeenCalled();

    store.dispose();
    expect(optimisticSession.dispose).toHaveBeenCalledOnce();
  });

  it('does not enable or re-add a created terminal after disposal', async () => {
    let resolveBackend!: (value: Terminal) => void;
    mocks.createTerminal.mockReturnValue(
      new Promise<Terminal>((resolve) => {
        resolveBackend = resolve;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    const pending = store.createTerminal(terminal);
    const session = mocks.sessions[0];

    store.dispose();
    resolveBackend(terminal);
    await pending;

    expect(store.terminals.size).toBe(0);
    expect(session.enableConnection).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(mocks.deleteTerminal).toHaveBeenCalledWith({
      projectId: terminal.projectId,
      taskId: terminal.taskId,
      terminalId: terminal.id,
    });
  });

  it('deletes a late backend create again after its optimistic terminal was deleted', async () => {
    let resolveBackend!: (value: Terminal) => void;
    mocks.createTerminal.mockReturnValue(
      new Promise<Terminal>((resolve) => {
        resolveBackend = resolve;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    const creation = store.createTerminal(terminal);
    const session = mocks.sessions[0];

    await store.deleteTerminal(terminal.id);
    expect(mocks.deleteTerminal).toHaveBeenCalledTimes(1);
    resolveBackend(terminal);
    await creation;

    expect(mocks.deleteTerminal).toHaveBeenCalledTimes(2);
    expect(mocks.deleteTerminal).toHaveBeenLastCalledWith({
      projectId: terminal.projectId,
      taskId: terminal.taskId,
      terminalId: terminal.id,
    });
    expect(store.terminals.size).toBe(0);
    expect(session.enableConnection).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('logs and swallows a failed cleanup for a terminal created after disposal', async () => {
    const cleanupError = new Error('cleanup failed');
    let resolveBackend!: (value: Terminal) => void;
    mocks.createTerminal.mockReturnValue(
      new Promise<Terminal>((resolve) => {
        resolveBackend = resolve;
      })
    );
    mocks.deleteTerminal.mockRejectedValueOnce(cleanupError);
    const store = new TerminalManagerStore('project-1', 'task-1');
    const pending = store.createTerminal(terminal);

    store.dispose();
    resolveBackend(terminal);
    await expect(pending).resolves.toEqual(terminal);

    expect(mocks.logError).toHaveBeenCalledWith(
      'TerminalManagerStore: failed to clean up a terminal created after disposal',
      cleanupError
    );
    expect(store.terminals.size).toBe(0);
  });

  it('restores an optimistically deleted terminal when the active IPC delete fails', async () => {
    mocks.getTerminalsForTask.mockResolvedValue([terminal]);
    mocks.deleteTerminal.mockRejectedValueOnce(new Error('delete failed'));
    const store = new TerminalManagerStore('project-1', 'task-1');
    await store.load();

    await expect(store.deleteTerminal(terminal.id)).rejects.toThrow('delete failed');

    expect(store.terminals.has(terminal.id)).toBe(true);
    expect(mocks.sessions[0].dispose).not.toHaveBeenCalled();
    store.dispose();
  });

  it('does not overwrite a newer local terminal when an older IPC delete fails', async () => {
    let rejectDelete!: (error: Error) => void;
    mocks.getTerminalsForTask.mockResolvedValue([terminal]);
    mocks.deleteTerminal.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    await store.load();
    const deletedSession = mocks.sessions[0];
    const pending = store.deleteTerminal(terminal.id);
    const replacement = new TerminalStore({ ...terminal, name: 'Replacement' });
    runInAction(() => store.terminals.set(terminal.id, replacement));

    rejectDelete(new Error('delete failed'));
    await expect(pending).rejects.toThrow('delete failed');

    expect(store.terminals.get(terminal.id)).toBe(replacement);
    expect(deletedSession.dispose).toHaveBeenCalledOnce();
    store.dispose();
  });

  it('does not restore a failed pending delete after disposal', async () => {
    let rejectDelete!: (error: Error) => void;
    mocks.getTerminalsForTask.mockResolvedValue([terminal]);
    mocks.deleteTerminal.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      })
    );
    const store = new TerminalManagerStore('project-1', 'task-1');
    await store.load();
    const session = mocks.sessions[0];
    const pending = store.deleteTerminal(terminal.id);

    store.dispose();
    rejectDelete(new Error('delete failed'));
    await expect(pending).rejects.toThrow('delete failed');

    expect(store.terminals.size).toBe(0);
    expect(session.dispose).toHaveBeenCalledOnce();
  });

  it('runs a launch command in a standard persisted task terminal', async () => {
    mocks.createTerminal.mockImplementation(async (params) => ({ ...params, ssh: false }));
    const store = new TerminalManagerStore('project-1', 'task-1');

    const created = await store.createCommandTerminal({
      command: ' pnpm run dev ',
      label: 'Start locally',
      initialSize: { cols: 120, rows: 36 },
    });

    expect(mocks.createTerminal).toHaveBeenCalledWith({
      id: created.id,
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Start locally',
      initialSize: { cols: 120, rows: 36 },
    });
    expect(mocks.sendInput).toHaveBeenCalledWith(
      makePtySessionId('project-1', 'task-1', created.id),
      'pnpm run dev\r'
    );
  });

  it('gives repeated command terminals distinct labels', async () => {
    mocks.createTerminal.mockImplementation(async (params) => ({ ...params, ssh: false }));
    const store = new TerminalManagerStore('project-1', 'task-1');

    await store.createCommandTerminal({ command: 'pnpm run dev', label: 'Start locally' });
    await store.createCommandTerminal({ command: 'pnpm run dev', label: 'Start locally' });

    expect(mocks.createTerminal.mock.calls.map(([params]) => params.name)).toEqual([
      'Start locally',
      'Start locally 2',
    ]);
  });
});
