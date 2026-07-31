import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { TerminalManagerStore } from './terminal-manager';

const mocks = vi.hoisted(() => ({
  getTerminalsForTask: vi.fn<() => Promise<Terminal[]>>(),
  createTerminal: vi.fn<(terminal: CreateTerminalParams) => Promise<Terminal>>(),
  sendInput: vi.fn(),
  sessions: [] as Array<{
    sessionId: string;
    options?: { deferConnection?: boolean };
    connect: ReturnType<typeof vi.fn>;
    enableConnection: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    terminals: {
      getTerminalsForTask: mocks.getTerminalsForTask,
      createTerminal: mocks.createTerminal,
    },
    pty: {
      sendInput: mocks.sendInput,
    },
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
