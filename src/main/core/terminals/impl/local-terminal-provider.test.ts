import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@shared/terminals';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import {
  TERMINAL_SPAWN_TIMEOUT_MS,
  TerminalSpawnCancelledError,
  TerminalSpawnTimeoutError,
} from '@main/core/terminals/terminal-provider';
import { LocalTerminalProvider } from './local-terminal-provider';

const mocks = vi.hoisted(() => ({
  beginRegistration: vi.fn(),
  buildTerminalEnv: vi.fn(),
  cancelRegistration: vi.fn(),
  killTmuxSession: vi.fn(),
  logError: vi.fn(),
  register: vi.fn(),
  waitForRevealClaims: vi.fn(),
  resolveLocalPtySpawn: vi.fn(),
  resolveTmuxSessionName: vi.fn(),
  spawnLocalPty: vi.fn(),
  unregister: vi.fn(),
  wireTerminalDevServerWatcher: vi.fn(),
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: mocks.spawnLocalPty,
}));

vi.mock('@main/core/pty/pty-env', () => ({
  buildTerminalEnv: mocks.buildTerminalEnv,
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    beginRegistration: mocks.beginRegistration,
    cancelRegistration: mocks.cancelRegistration,
    register: mocks.register,
    waitForRevealClaims: mocks.waitForRevealClaims,
    unregister: mocks.unregister,
  },
}));

vi.mock('@main/core/pty/pty-spawn-platform', () => ({
  logLocalPtySpawnWarnings: vi.fn(),
  resolveLocalPtySpawn: mocks.resolveLocalPtySpawn,
}));

vi.mock('@main/core/pty/tmux-availability', () => ({
  resolveAvailableTmuxSessionName: mocks.resolveTmuxSessionName,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession: mocks.killTmuxSession,
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
  },
}));

vi.mock('../dev-server-watcher', () => ({
  wireTerminalDevServerWatcher: mocks.wireTerminalDevServerWatcher,
}));

class FakePty implements Pty {
  readonly kill = vi.fn();
  readonly pause = vi.fn();
  readonly resume = vi.fn();
  private exitHandler: ((info: PtyExitInfo) => void) | null = null;

  write(): void {}

  resize(): void {}

  onData(): void {}

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandler = handler;
  }

  emitExit(info: PtyExitInfo = { exitCode: 0 }): void {
    this.exitHandler?.(info);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Terminal',
};
const sessionId = 'project-1:task-1:terminal-1';

function createProvider(): LocalTerminalProvider {
  return new LocalTerminalProvider({
    projectId: terminal.projectId,
    scopeId: terminal.taskId,
    taskPath: '/workspace',
    ctx: {} as IExecutionContext,
  });
}

describe('LocalTerminalProvider start lifecycle', () => {
  const spawned: FakePty[] = [];
  let registrationEpoch = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    spawned.length = 0;
    registrationEpoch = 0;
    mocks.beginRegistration.mockImplementation(() => {
      registrationEpoch += 1;
      return registrationEpoch;
    });
    mocks.buildTerminalEnv.mockReturnValue({});
    mocks.killTmuxSession.mockResolvedValue(undefined);
    mocks.resolveLocalPtySpawn.mockReturnValue({
      command: '/bin/zsh',
      args: [],
      cwd: '/workspace',
      warnings: [],
    });
    mocks.resolveTmuxSessionName.mockResolvedValue(undefined);
    mocks.waitForRevealClaims.mockResolvedValue(true);
    mocks.spawnLocalPty.mockImplementation(() => {
      const pty = new FakePty();
      spawned.push(pty);
      return pty;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('single-flights concurrent starts for the same session', async () => {
    const tmux = deferred<string | undefined>();
    mocks.resolveTmuxSessionName.mockReturnValueOnce(tmux.promise);
    const provider = createProvider();

    const first = provider.spawnTerminal(terminal);
    const second = provider.spawnTerminal(terminal);

    expect(mocks.beginRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTmuxSessionName).toHaveBeenCalledTimes(1);
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();

    tmux.resolve(undefined);
    await Promise.all([first, second]);

    expect(mocks.spawnLocalPty).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });

  it('invalidates a pending start and unregisters even when kill has no live PTY', async () => {
    const tmux = deferred<string | undefined>();
    mocks.resolveTmuxSessionName.mockReturnValueOnce(tmux.promise);
    const provider = createProvider();
    const start = provider.spawnTerminal(terminal);
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);

    await provider.killTerminal(terminal.id);
    await cancelled;

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    tmux.resolve(undefined);
    await Promise.resolve();
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('honors hydration cancellation without allowing a late local spawn', async () => {
    const tmux = deferred<string | undefined>();
    mocks.resolveTmuxSessionName.mockReturnValueOnce(tmux.promise);
    const provider = createProvider();
    const controller = new AbortController();
    const start = provider.spawnTerminal(terminal, undefined, undefined, {
      signal: controller.signal,
    });
    const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);

    controller.abort();
    await cancelled;
    tmux.resolve(undefined);
    await Promise.resolve();

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('times out a hung local start and prevents it from spawning late', async () => {
    const tmux = deferred<string | undefined>();
    mocks.resolveTmuxSessionName.mockReturnValueOnce(tmux.promise);
    const provider = createProvider();
    const start = provider.spawnTerminal(terminal);
    const timedOut = expect(start).rejects.toBeInstanceOf(TerminalSpawnTimeoutError);

    await vi.advanceTimersByTimeAsync(TERMINAL_SPAWN_TIMEOUT_MS);
    await timedOut;
    tmux.resolve(undefined);
    await Promise.resolve();

    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it.each(['detachAll', 'destroyAll'] as const)(
    '%s invalidates an in-flight start without allowing a late spawn',
    async (method) => {
      const tmux = deferred<string | undefined>();
      mocks.resolveTmuxSessionName.mockReturnValueOnce(tmux.promise);
      const provider = createProvider();
      const start = provider.spawnTerminal(terminal);
      const cancelled = expect(start).rejects.toBeInstanceOf(TerminalSpawnCancelledError);

      await provider[method]();
      await cancelled;

      expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
      expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
      tmux.resolve(undefined);
      await Promise.resolve();
      expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
      expect(mocks.register).not.toHaveBeenCalled();
    }
  );

  it('rolls back a spawned PTY when startup becomes stale before register', async () => {
    const provider = createProvider();
    mocks.wireTerminalDevServerWatcher.mockImplementationOnce(() => {
      void provider.killTerminal(terminal.id);
    });

    await expect(provider.spawnTerminal(terminal)).rejects.toBeInstanceOf(
      TerminalSpawnCancelledError
    );

    expect(spawned).toHaveLength(1);
    expect(spawned[0].kill).toHaveBeenCalled();
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('does not unregister the input epoch of a replacement start during stale rollback', async () => {
    const provider = createProvider();
    let replacement: Promise<void> | undefined;
    mocks.wireTerminalDevServerWatcher.mockImplementationOnce(() => {
      void provider.killTerminal(terminal.id);
      replacement = provider.spawnTerminal(terminal);
    });

    await expect(provider.spawnTerminal(terminal)).rejects.toBeInstanceOf(
      TerminalSpawnCancelledError
    );
    if (!replacement) throw new Error('replacement start was not scheduled');
    await replacement;

    expect(spawned).toHaveLength(2);
    expect(mocks.unregister).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith(
      sessionId,
      spawned[1],
      expect.objectContaining({ registrationEpoch: 2 })
    );
    expect(mocks.cancelRegistration).not.toHaveBeenCalledWith(sessionId, 2);
  });

  it('kills and unregisters a spawned PTY when post-spawn setup throws', async () => {
    const provider = createProvider();
    mocks.wireTerminalDevServerWatcher.mockImplementationOnce(() => {
      throw new Error('watcher failed');
    });

    await expect(provider.spawnTerminal(terminal)).rejects.toThrow('watcher failed');

    expect(spawned[0].kill).toHaveBeenCalledTimes(1);
    expect(mocks.unregister).toHaveBeenCalledWith(sessionId);
    expect(mocks.cancelRegistration).toHaveBeenCalledWith(sessionId, 1);
  });

  it('does not retain a PTY that exits synchronously while registry input is draining', async () => {
    const provider = createProvider();
    mocks.register.mockImplementationOnce((_sessionId: string, pty: FakePty) => {
      pty.emitExit({ exitCode: 1 });
    });

    await provider.spawnTerminal(terminal);
    await vi.advanceTimersByTimeAsync(500);

    expect(spawned).toHaveLength(2);
    expect(mocks.register).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale PTY exit after a replacement has won the session', async () => {
    const provider = createProvider();
    await provider.spawnTerminal(terminal);
    const oldPty = spawned[0];

    await provider.killTerminal(terminal.id);
    await provider.spawnTerminal(terminal);
    const winner = spawned[1];
    vi.clearAllMocks();

    oldPty.emitExit();
    await vi.advanceTimersByTimeAsync(500);
    await provider.spawnTerminal(terminal);

    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
    expect(winner.kill).not.toHaveBeenCalled();
  });
});
