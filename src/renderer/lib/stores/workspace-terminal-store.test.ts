import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { WorkspaceTerminalStore } from './workspace-terminal-store';

const mocks = vi.hoisted(() => ({
  getWorkspaceTerminals: vi.fn<() => Promise<Terminal[]>>(),
  createWorkspaceTerminal: vi.fn<(params: CreateTerminalParams) => Promise<Terminal>>(),
  deleteWorkspaceTerminal: vi.fn(async () => {}),
  renameWorkspaceTerminal: vi.fn(async () => {}),
  runWorkspaceRuntimeAction: vi.fn(async () => {}),
  createTaskTerminal: vi.fn(),
  sendInput: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    terminals: {
      getWorkspaceTerminals: mocks.getWorkspaceTerminals,
      createWorkspaceTerminal: mocks.createWorkspaceTerminal,
      deleteWorkspaceTerminal: mocks.deleteWorkspaceTerminal,
      renameWorkspaceTerminal: mocks.renameWorkspaceTerminal,
      runWorkspaceRuntimeAction: mocks.runWorkspaceRuntimeAction,
      getTerminalsForTask: vi.fn(),
      createTerminal: mocks.createTaskTerminal,
      deleteTerminal: vi.fn(),
      renameTerminal: vi.fn(),
    },
    pty: { sendInput: mocks.sendInput },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    readonly sessionId: string;
    readonly pty = { lastSentDims: null };
    readonly enableConnection = vi.fn();
    readonly dispose = vi.fn();

    constructor(sessionId: string) {
      this.sessionId = sessionId;
    }
  },
}));

describe('WorkspaceTerminalStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceTerminals.mockResolvedValue([]);
    mocks.createWorkspaceTerminal.mockImplementation(async (params) => params);
    mocks.sendInput.mockResolvedValue({ success: true, data: { queued: false } });
  });

  it('runs a quick action in a standard project Terminal without creating a task terminal', async () => {
    const store = new WorkspaceTerminalStore();
    const project = { id: 'project-1', type: 'local', path: '/repo' } as const;

    await store.runCommand(project as never, 'pnpm run dev', 'Start locally');

    expect(store.isOpen).toBe(true);
    expect(store.manager?.taskId).toBe('local:project-1:project-view');
    expect(mocks.createWorkspaceTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Start locally',
      })
    );
    const terminalId = mocks.createWorkspaceTerminal.mock.calls[0]?.[0].id;
    expect(mocks.sendInput).toHaveBeenCalledWith(
      `project-1:local:project-1:project-view:${terminalId}`,
      'pnpm run dev\r'
    );
    expect(mocks.createTaskTerminal).not.toHaveBeenCalled();
  });

  it('opens runtime actions as ordinary global Terminal tabs', async () => {
    const store = new WorkspaceTerminalStore();

    await store.runRuntimeAction('codex', 'doctor');

    expect(store.manager?.projectId).toBe('workspace');
    expect(store.manager?.taskId).toBe('global');
    const terminalId = mocks.createWorkspaceTerminal.mock.calls[0]?.[0].id;
    expect(mocks.runWorkspaceRuntimeAction).toHaveBeenCalledWith(terminalId, {
      runtimeId: 'codex',
      action: 'doctor',
    });
  });

  it('switches an open project Terminal to the active project without creating a shell', async () => {
    const store = new WorkspaceTerminalStore();
    const first = { id: 'project-1', type: 'local', path: '/repo-1' } as const;
    const second = { id: 'project-2', type: 'local', path: '/repo-2' } as const;

    await store.openProject(first as never, { ensureTerminal: false });
    await store.syncActiveProject(second as never);

    expect(store.isOpen).toBe(true);
    expect(store.activeProjectId).toBe('project-2');
    expect(store.manager?.taskId).toBe('local:project-2:project-view');
    expect(mocks.createWorkspaceTerminal).not.toHaveBeenCalled();
  });

  it('closes a project Terminal when navigation leaves project context', async () => {
    const store = new WorkspaceTerminalStore();
    const project = { id: 'project-1', type: 'local', path: '/repo' } as const;

    await store.openProject(project as never, { ensureTerminal: false });
    await store.syncActiveProject(null);

    expect(store.isOpen).toBe(false);
  });
});
