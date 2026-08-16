import { autorun } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateMachineCapacityCache } from './machine-capacity';
import { PtySession } from './pty-session';
import { invalidateTerminalSettingsCache } from './terminal-settings-cache';

const GIB = 1024 ** 3;

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    disposeAndWait: ReturnType<typeof vi.fn>;
    mounted: boolean;
    failConnection: (error: unknown) => void;
  }>,
  getTerminalSettings: vi.fn(async () => ({})),
  getMachineCapacity: vi.fn(async () => ({ totalMemoryBytes: 0, cpuCount: 0 })),
  throwOnConstruct: false,
  onExit: vi.fn(),
  exitListeners: new Map<string, () => void>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: mocks.onExit,
  },
  rpc: {
    app: {
      getMachineCapacity: mocks.getMachineCapacity,
    },
    appSettings: {
      get: mocks.getTerminalSettings,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    readonly connect = vi.fn(async () => {});
    readonly dispose = vi.fn();
    readonly disposeAndWait = vi.fn(async () => {});
    lastSentDims = null;
    mounted = false;
    hasRecoverableSnapshot = true;
    terminal = { options: { fontFamily: '' } };
    private readonly onConnectionError?: (error: unknown) => void;

    constructor(
      _sessionId: string,
      _theme?: unknown,
      options?: { onConnectionError?: (error: unknown) => void }
    ) {
      if (mocks.throwOnConstruct) throw new Error('xterm preparation failed');
      this.onConnectionError = options?.onConnectionError;
      mocks.instances.push(this);
    }

    setScrollbackLines() {}
    takeHiddenOutputCodeUnits() {
      return 0;
    }

    failConnection(error: unknown) {
      this.onConnectionError?.(error);
    }
  },
}));

describe('PtySession connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTerminalSettingsCache();
    invalidateMachineCapacityCache();
    mocks.instances.length = 0;
    mocks.getTerminalSettings.mockResolvedValue({});
    mocks.getMachineCapacity.mockResolvedValue({ totalMemoryBytes: 16 * GIB, cpuCount: 8 });
    mocks.throwOnConstruct = false;
    mocks.exitListeners.clear();
    mocks.onExit.mockImplementation((_event, callback, topic) => {
      if (!topic) return () => {};
      mocks.exitListeners.set(topic, callback);
      return () => mocks.exitListeners.delete(topic);
    });
  });

  it('does not connect merely because status is observed', async () => {
    const session = new PtySession('observed');
    const stop = autorun(() => session.status);

    await Promise.resolve();

    expect(mocks.instances).toHaveLength(0);
    stop();
  });

  it('does not connect a deferred session when only its backend gate opens', async () => {
    const session = new PtySession('enabled-without-demand', { deferConnection: true });
    const stop = autorun(() => session.status);

    session.enableConnection();
    await Promise.resolve();

    expect(mocks.instances).toHaveLength(0);
    stop();
  });

  it('latches explicit demand until a deferred backend is ready', async () => {
    const session = new PtySession('deferred', { deferConnection: true });
    const stop = autorun(() => session.status);

    await session.connect();
    await Promise.resolve();
    expect(mocks.instances).toHaveLength(0);

    session.enableConnection();
    await vi.waitFor(() => expect(session.status).toBe('ready'));
    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0].connect).not.toHaveBeenCalled();
    stop();
  });

  it('clears deferred demand when the owning entity is disposed', async () => {
    const session = new PtySession('disposed-deferred', { deferConnection: true });

    await session.connect();
    session.dispose();
    session.enableConnection();
    await Promise.resolve();

    expect(mocks.instances).toHaveLength(0);
  });

  it('deduplicates concurrent frontend preparation without subscribing output', async () => {
    const session = new PtySession('single-flight');

    await Promise.all([session.connect(), session.connect(), session.connect()]);

    expect(mocks.instances).toHaveLength(1);
    expect(mocks.instances[0].connect).not.toHaveBeenCalled();
    expect(session.status).toBe('ready');
  });

  it('reuses one terminal settings snapshot across task-session preparations', async () => {
    const first = new PtySession('settings-first');
    const second = new PtySession('settings-second');

    await first.connect();
    await second.connect();

    expect(mocks.getTerminalSettings).toHaveBeenCalledTimes(1);
    first.dispose();
    second.dispose();
  });

  it('surfaces frontend preparation failures and allows a retry', async () => {
    const session = new PtySession('failed-preparation');
    mocks.throwOnConstruct = true;

    await expect(session.connect()).rejects.toThrow('xterm preparation failed');
    expect(session.status).toBe('disconnected');
    expect(session.pty).toBeNull();
    expect(session.connectionError).toContain('xterm preparation failed');

    mocks.throwOnConstruct = false;
    await session.connect();

    expect(session.status).toBe('ready');
    expect(session.connectionError).toBeNull();
  });

  it('surfaces a late output-subscription failure without an automatic retry storm', async () => {
    const session = new PtySession('failed-output-subscription');
    await session.connect();
    const failedRenderer = mocks.instances.at(-1);

    failedRenderer?.failConnection(new Error('PTY output subscription timed out'));
    await Promise.resolve();
    await Promise.resolve();

    expect(failedRenderer?.dispose).toHaveBeenCalledOnce();
    expect(session.pty).toBeNull();
    expect(session.connectionError).toContain('PTY output subscription timed out');
    expect(mocks.instances).toHaveLength(1);

    await session.connect();
    expect(mocks.instances).toHaveLength(2);
    expect(session.pty).not.toBeNull();
    expect(session.connectionError).toBeNull();
    session.dispose();
  });

  it('tracks command process exit without waiting for a terminal surface to mount', () => {
    const session = new PtySession('one-shot', { execution: 'command' });

    expect(session.hasExited).toBe(false);
    mocks.exitListeners.get('one-shot')?.();
    expect(session.hasExited).toBe(true);

    session.dispose();
    expect(mocks.exitListeners.has('one-shot')).toBe(false);
  });

  it('bounds the auto policy to the limit this machine can afford', async () => {
    PtySession.setHotTerminalPolicy('auto', 2);
    const sessions = Array.from({ length: 20 }, (_, index) => new PtySession(`auto-${index}`));
    const firstNewInstance = mocks.instances.length;

    await Promise.all(sessions.map((session) => session.connect()));

    const instances = mocks.instances.slice(firstNewInstance);
    expect(instances).toHaveLength(20);
    expect(
      instances.filter((instance) => instance.disposeAndWait.mock.calls.length === 0)
    ).toHaveLength(4);
    expect(
      instances
        .slice(0, 16)
        .every((instance) =>
          instance.disposeAndWait.mock.calls.some(([options]) =>
            Object.is((options as { checkpoint?: boolean } | undefined)?.checkpoint, true)
          )
        )
    ).toBe(true);
    for (const session of sessions) session.dispose();
  });

  it('keeps more renderers warm on a machine with more memory and cores', async () => {
    mocks.getMachineCapacity.mockResolvedValue({ totalMemoryBytes: 64 * GIB, cpuCount: 16 });
    const sessions = Array.from({ length: 20 }, (_, index) => new PtySession(`roomy-${index}`));
    const firstNewInstance = mocks.instances.length;

    await Promise.all(sessions.map((session) => session.connect()));

    const instances = mocks.instances.slice(firstNewInstance);
    expect(
      instances.filter((instance) => instance.disposeAndWait.mock.calls.length === 0)
    ).toHaveLength(8);
    for (const session of sessions) session.dispose();
  });

  it('falls back to the conservative default when the capacity probe fails', async () => {
    mocks.getMachineCapacity.mockRejectedValue(new Error('machine capacity unavailable'));
    PtySession.setHotTerminalPolicy('auto', 2, { totalMemoryBytes: 0, cpuCount: 0 });
    const sessions = Array.from({ length: 8 }, (_, index) => new PtySession(`blind-${index}`));
    const firstNewInstance = mocks.instances.length;

    await Promise.all(sessions.map((session) => session.connect()));

    const instances = mocks.instances.slice(firstNewInstance);
    expect(instances).toHaveLength(8);
    expect(
      instances.filter((instance) => instance.disposeAndWait.mock.calls.length === 0)
    ).toHaveLength(4);
    for (const session of sessions) session.dispose();
  });

  it('captures a current-frame checkpoint when the fixed cache evicts a renderer', async () => {
    mocks.getTerminalSettings.mockResolvedValue({
      hotTerminalMode: 'fixed',
      hotTerminalLimit: 1,
    });
    const first = new PtySession('fixed-first');
    const second = new PtySession('fixed-second');

    await first.connect();
    const firstInstance = mocks.instances.at(-1);
    await second.connect();

    expect(firstInstance?.disposeAndWait).toHaveBeenCalledWith({ checkpoint: true });
    first.dispose();
    second.dispose();
    PtySession.setHotTerminalPolicy('auto', 4);
  });

  it('waits for an evicted checkpoint before recreating the same renderer', async () => {
    mocks.getTerminalSettings.mockResolvedValue({
      hotTerminalMode: 'fixed',
      hotTerminalLimit: 1,
    });
    const first = new PtySession('barrier-first');
    const second = new PtySession('barrier-second');

    await first.connect();
    const firstInstance = mocks.instances.at(-1);
    let releaseCheckpoint!: () => void;
    const checkpointStored = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    firstInstance?.disposeAndWait.mockReturnValueOnce(checkpointStored);

    await second.connect();
    const reconnect = first.connect();
    await Promise.resolve();

    expect(firstInstance?.disposeAndWait).toHaveBeenCalledWith({ checkpoint: true });
    expect(mocks.instances).toHaveLength(2);

    releaseCheckpoint();
    await reconnect;

    expect(mocks.instances).toHaveLength(3);
    first.dispose();
    second.dispose();
    PtySession.setHotTerminalPolicy('auto', 4);
  });

  it('does not recreate an evicted renderer after its owning session is disposed', async () => {
    mocks.getTerminalSettings.mockResolvedValue({
      hotTerminalMode: 'fixed',
      hotTerminalLimit: 1,
    });
    const first = new PtySession('disposed-barrier-first');
    const second = new PtySession('disposed-barrier-second');

    await first.connect();
    const firstInstance = mocks.instances.at(-1);
    let releaseCheckpoint!: () => void;
    const checkpointStored = new Promise<void>((resolve) => {
      releaseCheckpoint = resolve;
    });
    firstInstance?.disposeAndWait.mockReturnValueOnce(checkpointStored);

    await second.connect();
    const reconnect = first.connect();
    first.dispose();
    releaseCheckpoint();
    await reconnect;

    expect(mocks.instances).toHaveLength(2);
    second.dispose();
    PtySession.setHotTerminalPolicy('auto', 4);
  });
});
