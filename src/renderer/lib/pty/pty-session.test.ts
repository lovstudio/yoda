import { autorun } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtySession } from './pty-session';
import { invalidateTerminalSettingsCache } from './terminal-settings-cache';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    disposeAndWait: ReturnType<typeof vi.fn>;
    mounted: boolean;
  }>,
  getTerminalSettings: vi.fn(async () => ({})),
  throwOnConstruct: false,
  onExit: vi.fn(),
  exitListeners: new Map<string, () => void>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: mocks.onExit,
  },
  rpc: {
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

    constructor() {
      if (mocks.throwOnConstruct) throw new Error('xterm preparation failed');
      mocks.instances.push(this);
    }

    setScrollbackLines() {}
    takeHiddenOutputCodeUnits() {
      return 0;
    }
  },
}));

describe('PtySession connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateTerminalSettingsCache();
    mocks.instances.length = 0;
    mocks.getTerminalSettings.mockResolvedValue({});
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

  it('tracks command process exit without waiting for a terminal surface to mount', () => {
    const session = new PtySession('one-shot', { execution: 'command' });

    expect(session.hasExited).toBe(false);
    mocks.exitListeners.get('one-shot')?.();
    expect(session.hasExited).toBe(true);

    session.dispose();
    expect(mocks.exitListeners.has('one-shot')).toBe(false);
  });

  it('bounds the default auto policy to four frontend terminal parsers', async () => {
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
