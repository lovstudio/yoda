import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@shared/terminals';
import { TerminalManagerStore } from './terminal-manager';

const mocks = vi.hoisted(() => ({
  getTerminalsForTask: vi.fn<() => Promise<Terminal[]>>(),
  createTerminal: vi.fn<(terminal: Terminal) => Promise<Terminal>>(),
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
  });

  it('loads inactive terminal tabs without eagerly constructing renderer connections', async () => {
    mocks.getTerminalsForTask.mockResolvedValue([terminal]);
    const store = new TerminalManagerStore('project-1', 'task-1');

    await store.load();

    expect(store.terminals.has(terminal.id)).toBe(true);
    expect(mocks.sessions).toHaveLength(1);
    expect(mocks.sessions[0].connect).not.toHaveBeenCalled();
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
});
