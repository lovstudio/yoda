import { autorun } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtySession } from './pty-session';

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    readonly connect = vi.fn(async () => {});
    readonly dispose = vi.fn();
    lastSentDims = null;

    constructor() {
      mocks.instances.push(this);
    }

    setRendererPreference() {}
    setScrollbackLines() {}
  },
}));

describe('PtySession connection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instances.length = 0;
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
});
