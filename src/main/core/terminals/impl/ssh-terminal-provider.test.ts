import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@shared/terminals';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import {
  TERMINAL_SPAWN_TIMEOUT_MS,
  TerminalSpawnCancelledError,
} from '@main/core/terminals/terminal-provider';
import { SshTerminalOpenError, SshTerminalProvider } from './ssh-terminal-provider';

const mocks = vi.hoisted(() => {
  const registeredSessions = new Map<string, unknown>();
  const epochState = { next: 1 };
  const registerHook: {
    current: ((sessionId: string, pty: unknown) => void) | null;
  } = { current: null };
  return {
    registeredSessions,
    epochState,
    registerHook,
    beginRegistration: vi.fn(() => epochState.next++),
    cancelRegistration: vi.fn(),
    register: vi.fn((sessionId: string, pty: unknown) => {
      registeredSessions.set(sessionId, pty);
      registerHook.current?.(sessionId, pty);
    }),
    unregister: vi.fn((sessionId: string) => {
      registeredSessions.delete(sessionId);
    }),
    getRegistered: vi.fn((sessionId: string) => registeredSessions.get(sessionId)),
    openSsh2Pty: vi.fn(),
    resolveSshCommand: vi.fn(() => 'ssh-command'),
    resolveTmuxSessionName: vi.fn(),
    killTmuxSession: vi.fn(),
    wireTerminalDevServerWatcher: vi.fn(),
    connectionOn: vi.fn(),
    connectionOff: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
  };
});

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    beginRegistration: mocks.beginRegistration,
    cancelRegistration: mocks.cancelRegistration,
    register: mocks.register,
    unregister: mocks.unregister,
    get: mocks.getRegistered,
  },
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty: mocks.openSsh2Pty,
}));

vi.mock('@main/core/pty/spawn-utils', () => ({
  resolveSshCommand: mocks.resolveSshCommand,
}));

vi.mock('@main/core/pty/tmux-availability', () => ({
  resolveAvailableTmuxSessionName: mocks.resolveTmuxSessionName,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession: mocks.killTmuxSession,
}));

vi.mock('../dev-server-watcher', () => ({
  wireTerminalDevServerWatcher: mocks.wireTerminalDevServerWatcher,
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: {
    on: mocks.connectionOn,
    off: mocks.connectionOff,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
    warn: mocks.logWarn,
  },
}));

class FakePty implements Pty {
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  onData(): void {}

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) handler(info);
  }
}

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal',
  ssh: true,
};

const sessionId = `${terminal.projectId}:${terminal.taskId}:${terminal.id}`;

function makeTerminal(index: number, taskId = terminal.taskId): Terminal {
  return {
    ...terminal,
    id: `terminal-${index}`,
    taskId,
    name: `Terminal ${index}`,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createProvider(
  options: { taskId?: string; connectionId?: string; client?: object; tmux?: boolean } = {}
): {
  provider: SshTerminalProvider;
  getRemoteShellProfile: ReturnType<typeof vi.fn>;
} {
  const getRemoteShellProfile = vi.fn(async () => ({
    shell: '/bin/zsh',
    env: { PATH: '/usr/bin' },
  }));
  const provider = new SshTerminalProvider({
    projectId: terminal.projectId,
    scopeId: options.taskId ?? terminal.taskId,
    taskPath: '/remote/task',
    tmux: options.tmux,
    ctx: {
      supportsLocalSpawn: false,
      exec: vi.fn(),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    } as never,
    proxy: {
      client: options.client ?? {},
      getRemoteShellProfile,
    } as never,
    connectionId: options.connectionId ?? 'connection-1',
  });
  return { provider, getRemoteShellProfile };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.registeredSessions.clear();
  mocks.epochState.next = 1;
  mocks.registerHook.current = null;
  mocks.openSsh2Pty.mockReset();
  mocks.resolveTmuxSessionName.mockReset().mockResolvedValue(undefined);
  mocks.killTmuxSession.mockReset().mockResolvedValue(undefined);
  mocks.wireTerminalDevServerWatcher.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SshTerminalProvider start lifecycle', () => {
  it('coalesces concurrent starts for the same session', async () => {
    const { provider } = createProvider();
    const opened = deferred<{ success: true; data: FakePty }>();
    const pty = new FakePty();
    mocks.openSsh2Pty.mockReturnValue(opened.promise);

    const first = provider.spawnTerminal(terminal);
    const second = provider.spawnTerminal(terminal);
    await flushMicrotasks();

    expect(mocks.beginRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(1);

    opened.resolve({ success: true, data: pty });
    await Promise.all([first, second]);

    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registeredSessions.get(sessionId)).toBe(pty);
  });

  it('invalidates and rolls back a PTY that finishes opening after kill', async () => {
    const { provider } = createProvider();
    const opened = deferred<{ success: true; data: FakePty }>();
    const stalePty = new FakePty();
    mocks.openSsh2Pty.mockReturnValue(opened.promise);

    const start = provider.spawnTerminal(terminal);
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);
    await flushMicrotasks();
    await provider.killTerminal(terminal.id);
    await cancelled;

    opened.resolve({ success: true, data: stalePty });
    await flushMicrotasks();

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(stalePty.kill).toHaveBeenCalledTimes(1);
    expect(mocks.registeredSessions.has(sessionId)).toBe(false);
  });

  it('invalidates and rolls back a pending start during detach', async () => {
    const { provider } = createProvider();
    const opened = deferred<{ success: true; data: FakePty }>();
    const stalePty = new FakePty();
    mocks.openSsh2Pty.mockReturnValue(opened.promise);

    const start = provider.spawnTerminal(terminal);
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);
    await flushMicrotasks();
    await provider.detachAll();
    await cancelled;

    opened.resolve({ success: true, data: stalePty });
    await flushMicrotasks();

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(stalePty.kill).toHaveBeenCalledTimes(1);

    await provider.rehydrate();
    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(1);
  });

  it('removes its reconnect listener once when detached', async () => {
    const { provider } = createProvider();
    const reconnectHandler = mocks.connectionOn.mock.calls[0]?.[1];

    await provider.detachAll();
    await provider.detachAll();

    expect(mocks.connectionOff).toHaveBeenCalledOnce();
    expect(mocks.connectionOff).toHaveBeenCalledWith('connection-event', reconnectHandler);
  });

  it('invalidates and rolls back a pending start during destroy', async () => {
    const { provider } = createProvider();
    const opened = deferred<{ success: true; data: FakePty }>();
    const stalePty = new FakePty();
    mocks.openSsh2Pty.mockReturnValue(opened.promise);

    const start = provider.spawnTerminal(terminal);
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);
    await flushMicrotasks();
    await provider.destroyAll();
    await cancelled;

    opened.resolve({ success: true, data: stalePty });
    await flushMicrotasks();

    expect(mocks.connectionOff).toHaveBeenCalledTimes(1);
    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(stalePty.kill).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale PTY exit after a replacement wins', async () => {
    const { provider } = createProvider();
    const oldPty = new FakePty();
    const winnerPty = new FakePty();
    mocks.openSsh2Pty
      .mockResolvedValueOnce({ success: true, data: oldPty })
      .mockResolvedValueOnce({ success: true, data: winnerPty });

    await provider.spawnTerminal(terminal);
    await provider.killTerminal(terminal.id);
    await provider.spawnTerminal(terminal);

    oldPty.emitExit({ exitCode: 1 });
    await provider.spawnTerminal(terminal);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(2);
    expect(mocks.registeredSessions.get(sessionId)).toBe(winnerPty);
  });

  it('kills and unregisters a spawned PTY when setup throws', async () => {
    const { provider } = createProvider();
    const pty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    mocks.wireTerminalDevServerWatcher.mockImplementationOnce(() => {
      throw new Error('watcher setup failed');
    });

    await expect(provider.spawnTerminal(terminal)).rejects.toThrow('watcher setup failed');

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.registeredSessions.has(sessionId)).toBe(false);
  });

  it('does not commit a PTY that exits synchronously while registry input is draining', async () => {
    const { provider } = createProvider();
    const exitedPty = new FakePty();
    const winnerPty = new FakePty();
    mocks.openSsh2Pty
      .mockResolvedValueOnce({ success: true, data: exitedPty })
      .mockResolvedValueOnce({ success: true, data: winnerPty });
    mocks.registerHook.current = (_registeredSessionId, pty) => {
      if (pty === exitedPty) exitedPty.emitExit({ exitCode: 1 });
    };

    await provider.spawnTerminal(terminal);
    await provider.spawnTerminal(terminal);
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(2);
    expect(mocks.registeredSessions.get(sessionId)).toBe(winnerPty);
  });

  it('deduplicates concurrent rehydrate passes and their terminal start', async () => {
    const { provider } = createProvider();
    mocks.openSsh2Pty.mockResolvedValueOnce({
      success: false,
      error: { kind: 'channel-open-failed', message: 'offline' },
    });
    await expect(provider.spawnTerminal(terminal)).rejects.toBeInstanceOf(SshTerminalOpenError);

    const opened = deferred<{ success: true; data: FakePty }>();
    const pty = new FakePty();
    mocks.openSsh2Pty.mockReturnValueOnce(opened.promise);

    const first = provider.rehydrate();
    const second = provider.rehydrate();
    await flushMicrotasks();

    expect(first).toBe(second);
    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(2);

    opened.resolve({ success: true, data: pty });
    await Promise.all([first, second]);
    await provider.rehydrate();

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(2);
    expect(mocks.registeredSessions.get(sessionId)).toBe(pty);
  });

  it('propagates an SSH channel-open failure while leaving no live registration', async () => {
    const { provider } = createProvider();
    mocks.openSsh2Pty.mockResolvedValueOnce({
      success: false,
      error: { kind: 'channel-open-failed', message: 'connection lost' },
    });

    await expect(provider.spawnTerminal(terminal)).rejects.toMatchObject({
      code: 'ssh_terminal_open_failed',
      terminalId: terminal.id,
      kind: 'channel-open-failed',
    });

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.registeredSessions.has(sessionId)).toBe(false);
  });

  it('shares a four-open limit across providers using one real ssh2 Client', async () => {
    const client = {};
    const { provider: firstProvider } = createProvider({
      taskId: 'task-1',
      connectionId: 'connection-1',
      client,
    });
    const { provider: secondProvider } = createProvider({
      taskId: 'task-2',
      connectionId: 'connection-alias',
      client,
    });
    const firstTerminals = Array.from({ length: 64 }, (_, index) => makeTerminal(index, 'task-1'));
    const secondTerminals = Array.from({ length: 64 }, (_, index) => makeTerminal(index, 'task-2'));
    mocks.openSsh2Pty.mockResolvedValue({
      success: false,
      error: { kind: 'channel-open-failed', message: 'offline' },
    });
    await Promise.all(
      firstTerminals
        .map((trackedTerminal) =>
          firstProvider.spawnTerminal(trackedTerminal).catch(() => undefined)
        )
        .concat(
          secondTerminals.map((trackedTerminal) =>
            secondProvider.spawnTerminal(trackedTerminal).catch(() => undefined)
          )
        )
    );

    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];
    mocks.openSsh2Pty.mockReset().mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        pending.push(() => {
          active -= 1;
          resolve({ success: true, data: new FakePty() });
        });
      });
    });

    const rehydrate = Promise.all([firstProvider.rehydrate(), secondProvider.rehydrate()]);
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(active).toBe(4);

    while (mocks.openSsh2Pty.mock.calls.length < firstTerminals.length + secondTerminals.length) {
      pending.shift()?.();
      await flushMicrotasks();
    }
    while (pending.length > 0) pending.shift()?.();
    await rehydrate;

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(firstTerminals.length + secondTerminals.length);
    expect(maxActive).toBe(4);
  });

  it('keeps actual opens capped at four after every caller-facing timeout', async () => {
    const { provider } = createProvider();
    const terminals = Array.from({ length: 8 }, (_, index) => makeTerminal(index));
    mocks.openSsh2Pty.mockResolvedValue({
      success: false,
      error: { kind: 'channel-open-failed', message: 'offline' },
    });
    await Promise.all(
      terminals.map((trackedTerminal) =>
        provider.spawnTerminal(trackedTerminal).catch(() => undefined)
      )
    );

    let active = 0;
    const pending: Array<() => void> = [];
    mocks.openSsh2Pty.mockReset().mockImplementation(() => {
      active += 1;
      return new Promise((resolve) => {
        pending.push(() => {
          active -= 1;
          resolve({ success: true, data: new FakePty() });
        });
      });
    });

    const rehydrate = provider.rehydrate();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(4);
    expect(active).toBe(4);

    await vi.advanceTimersByTimeAsync(TERMINAL_SPAWN_TIMEOUT_MS);
    await flushMicrotasks();

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(4);
    expect(active).toBe(4);

    await vi.advanceTimersByTimeAsync(TERMINAL_SPAWN_TIMEOUT_MS);
    await rehydrate;

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(4);
    expect(active).toBe(4);

    while (pending.length > 0) pending.shift()?.();
    await flushMicrotasks();

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(4);
    expect(active).toBe(0);
  });

  it('retains a timed-out terminal so a later rehydrate can retry successfully', async () => {
    const { provider } = createProvider({ tmux: true });
    mocks.resolveTmuxSessionName.mockResolvedValue('tmux-terminal-1');
    mocks.openSsh2Pty.mockResolvedValueOnce({
      success: false,
      error: { kind: 'channel-open-failed', message: 'offline' },
    });
    await expect(provider.spawnTerminal(terminal)).rejects.toBeInstanceOf(SshTerminalOpenError);

    const opened = deferred<{ success: true; data: FakePty }>();
    const stalePty = new FakePty();
    mocks.openSsh2Pty.mockReset().mockReturnValueOnce(opened.promise);

    const timedOutHydration = provider.rehydrate();
    await flushMicrotasks();
    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TERMINAL_SPAWN_TIMEOUT_MS);
    await timedOutHydration;

    opened.resolve({ success: true, data: stalePty });
    await flushMicrotasks();
    expect(stalePty.kill).toHaveBeenCalledTimes(1);
    expect(mocks.killTmuxSession).not.toHaveBeenCalled();
    expect(provider.isTerminalDetachable(terminal.id)).toBe(true);

    const winnerPty = new FakePty();
    mocks.openSsh2Pty.mockResolvedValueOnce({ success: true, data: winnerPty });
    await provider.rehydrate();

    expect(mocks.openSsh2Pty).toHaveBeenCalledTimes(2);
    expect(mocks.registeredSessions.get(sessionId)).toBe(winnerPty);
    expect(mocks.killTmuxSession).not.toHaveBeenCalled();
  });

  it('cleans tmux when a forgotten terminal finishes opening late', async () => {
    const { provider } = createProvider({ tmux: true });
    const opened = deferred<{ success: true; data: FakePty }>();
    const stalePty = new FakePty();
    mocks.resolveTmuxSessionName.mockResolvedValue('tmux-terminal-1');
    mocks.openSsh2Pty.mockReturnValue(opened.promise);

    const start = provider.spawnTerminal(terminal);
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);
    await flushMicrotasks();
    await provider.killTerminal(terminal.id);
    await cancelled;
    mocks.killTmuxSession.mockClear();

    opened.resolve({ success: true, data: stalePty });
    await flushMicrotasks();

    expect(stalePty.kill).toHaveBeenCalledTimes(1);
    expect(mocks.killTmuxSession).toHaveBeenCalledWith(expect.anything(), 'tmux-terminal-1');
  });
});
