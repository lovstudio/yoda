import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceShellStore } from './workspace-shell-store';

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => ({ sessionId: 'started' })),
  execute: vi.fn(async () => ({ sessionId: 'executed' })),
  runCommand: vi.fn(async () => ({ sessionId: 'command' })),
  stop: vi.fn(async () => {}),
  sessions: [] as Array<{
    sessionId: string;
    pty: { lastSentDims: { cols: number; rows: number } | null };
    enableConnection: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspaceShell: {
      start: mocks.start,
      execute: mocks.execute,
      runCommand: mocks.runCommand,
      stop: mocks.stop,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class MockPtySession {
    status = 'disconnected';
    pty = { lastSentDims: null as { cols: number; rows: number } | null };
    enableConnection = vi.fn();
    connect = vi.fn(async () => {
      this.status = 'ready';
    });
    dispose = vi.fn();

    constructor(readonly sessionId: string) {
      mocks.sessions.push(this);
    }
  },
}));

describe('WorkspaceShellStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.length = 0;
  });

  it('toggles the same shell closed and open without restarting it', async () => {
    const store = new WorkspaceShellStore();

    await store.toggleShell('/repo');
    const session = store.session;
    expect(store.isShellOpen).toBe(true);
    expect(mocks.start).toHaveBeenCalledWith({
      sessionId: session?.sessionId,
      cwd: '/repo',
      initialSize: undefined,
    });
    const mockSession = mocks.sessions[0];
    expect(mockSession.enableConnection).toHaveBeenCalledOnce();
    expect(mockSession.connect).toHaveBeenCalledOnce();
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(
      mockSession.connect.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );

    await store.toggleShell('/repo');
    expect(store.isOpen).toBe(false);
    expect(store.session).toBe(session);

    await store.toggleShell('/repo');
    expect(store.isShellOpen).toBe(true);
    expect(store.session).toBe(session);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('uses a fresh frontend session and the measured size for a runtime action', async () => {
    const store = new WorkspaceShellStore();
    await store.openShell('/repo');
    const shellSession = mocks.sessions[0];
    shellSession.pty.lastSentDims = { cols: 144, rows: 38 };

    await store.runRuntimeAction('codex', 'open', '/repo');

    expect(shellSession.dispose).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledWith(shellSession.sessionId);
    expect(mocks.sessions).toHaveLength(2);
    expect(store.session?.sessionId).toBe(mocks.sessions[1].sessionId);
    expect(store.mode).toBe('runtime-action');
    expect(store.runtimeId).toBe('codex');
    expect(store.runtimeAction).toBe('open');
    expect(mocks.execute).toHaveBeenCalledWith(mocks.sessions[1].sessionId, {
      runtimeId: 'codex',
      action: 'open',
      cwd: '/repo',
      initialSize: { cols: 144, rows: 38 },
    });
  });

  it('switches a runtime console back to a fresh plain shell', async () => {
    const store = new WorkspaceShellStore();
    await store.runRuntimeAction('codex', 'doctor');
    const runtimeSession = mocks.sessions[0];

    await store.toggleShell();

    expect(runtimeSession.dispose).toHaveBeenCalledOnce();
    expect(mocks.sessions).toHaveLength(2);
    expect(store.isShellOpen).toBe(true);
    expect(store.runtimeId).toBeNull();
    expect(store.runtimeAction).toBeNull();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh command terminal for a programmatic quick action', async () => {
    const store = new WorkspaceShellStore();

    await store.runCommand('pnpm run dev', '/repo', 'Start locally', 'task-1');

    expect(store.mode).toBe('command');
    expect(store.commandLabel).toBe('Start locally');
    expect(store.commandHostTaskId).toBe('task-1');
    expect(store.isCommandHostedInTask('task-1')).toBe(true);
    expect(store.isCommandSelectedInTask('task-1')).toBe(true);
    expect(store.isCommandHostedInTask('task-2')).toBe(false);
    store.selectTaskTerminal('task-1');
    expect(store.isCommandSelectedInTask('task-1')).toBe(false);
    store.selectHostedCommand('task-1');
    expect(store.isCommandSelectedInTask('task-1')).toBe(true);
    expect(store.isOpen).toBe(true);
    expect(mocks.runCommand).toHaveBeenCalledWith(store.session?.sessionId, {
      command: 'pnpm run dev',
      cwd: '/repo',
      initialSize: undefined,
    });
  });
});
