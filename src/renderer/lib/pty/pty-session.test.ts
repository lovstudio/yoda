import { autorun } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtySession } from './pty-session';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
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

  it('keeps 20 frontend terminal parsers resident in the default auto policy', async () => {
    PtySession.setHotTerminalPolicy('auto', 2);
    const sessions = Array.from({ length: 20 }, (_, index) => new PtySession(`auto-${index}`));
    const firstNewInstance = mocks.instances.length;

    await Promise.all(sessions.map((session) => session.connect()));

    expect(mocks.instances.slice(firstNewInstance)).toHaveLength(20);
    expect(
      mocks.instances
        .slice(firstNewInstance)
        .every((instance) => !instance.dispose.mock.calls.length)
    ).toBe(true);
    for (const session of sessions) session.dispose();
  });
});
