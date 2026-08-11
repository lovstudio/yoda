import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  projectTerminalScopeId,
  quickActionTerminalId,
  type CreateTerminalParams,
  type Terminal,
} from '@shared/terminals';
import { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { WORKSPACE_TERMINAL_SCOPE_LIMIT, WorkspaceTerminalStore } from './workspace-terminal-store';

const mocks = vi.hoisted(() => ({
  getWorkspaceTerminals: vi.fn<() => Promise<Terminal[]>>(),
  createWorkspaceTerminal: vi.fn<(params: CreateTerminalParams) => Promise<Terminal>>(),
  deleteWorkspaceTerminal: vi.fn(async () => {}),
  renameWorkspaceTerminal: vi.fn(async () => {}),
  runWorkspaceRuntimeAction: vi.fn(async () => {}),
  createTaskTerminal: vi.fn(),
  sendInput: vi.fn(),
}));

type ScopeResources = {
  manager: TerminalManagerStore;
  tabs: TerminalTabViewStore;
};

type WorkspaceTerminalStoreInternals = {
  scopes: Map<string, ScopeResources>;
  getOrCreateScope(
    projectId: string,
    scopeId: string,
    sourceProjectId: string | null
  ): ScopeResources;
};

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
        command: 'pnpm run dev',
        persist: false,
      })
    );
    expect(mocks.sendInput).not.toHaveBeenCalled();
    expect(mocks.createTaskTerminal).not.toHaveBeenCalled();
  });

  it('reopens the quick action scope instead of the currently routed project', async () => {
    const store = new WorkspaceTerminalStore();
    const quickActionProject = { id: 'project-1', type: 'local', path: '/repo-1' } as const;
    const routedProject = { id: 'project-2', type: 'local', path: '/repo-2' } as const;

    await store.runCommand(quickActionProject as never, 'pnpm run dev', 'Start locally');
    const terminalId = mocks.createWorkspaceTerminal.mock.calls[0]?.[0].id;
    await store.toggleForRuntimeBar(routedProject as never);

    expect(store.isOpen).toBe(false);

    await store.toggleForRuntimeBar(routedProject as never);

    expect(store.isOpen).toBe(true);
    expect(store.activeProjectId).toBe('project-1');
    expect(store.manager?.taskId).toBe('local:project-1:project-view');
    expect(store.tabs?.activeTabId).toBe(terminalId);
    expect(mocks.createWorkspaceTerminal).toHaveBeenCalledTimes(1);
  });

  it('tracks a running quick action and navigates back to its existing Terminal', async () => {
    const store = new WorkspaceTerminalStore();
    const project = { id: 'project-1', type: 'local', path: '/repo' } as const;
    const terminalId = quickActionTerminalId(project.id, 'start');

    await expect(
      store.runCommand(project as never, 'pnpm run dev', 'Start locally', 'start')
    ).resolves.toBe(terminalId);

    expect(store.isQuickActionRunning(project as never, 'start')).toBe(true);
    expect(mocks.createWorkspaceTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminalId })
    );

    store.close();
    await expect(store.openQuickActionTerminal(project as never, 'start')).resolves.toBe(true);
    expect(store.isOpen).toBe(true);
    expect(store.tabs?.activeTabId).toBe(terminalId);

    await store.runCommand(project as never, 'pnpm run dev', 'Start locally', 'start');
    expect(mocks.createWorkspaceTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.sendInput).not.toHaveBeenCalled();

    const terminalStore = store.manager?.terminals.get(terminalId);
    if (!terminalStore) throw new Error('Expected the quick action terminal to exist.');
    terminalStore.session.hasExited = true;
    expect(store.isQuickActionRunning(project as never, 'start')).toBe(false);
    await expect(store.openQuickActionTerminal(project as never, 'start')).resolves.toBe(false);

    await expect(
      store.runCommand(project as never, 'pnpm run dev', 'Start locally', 'start')
    ).resolves.toBe(terminalId);
    expect(mocks.deleteWorkspaceTerminal).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      terminalId,
    });
    expect(mocks.createWorkspaceTerminal).toHaveBeenCalledTimes(2);
    expect(store.isQuickActionRunning(project as never, 'start')).toBe(true);

    await store.manager?.deleteTerminal(terminalId);
    expect(store.isQuickActionRunning(project as never, 'start')).toBe(false);
  });

  it('does not treat a hydrated legacy quick action Terminal as running', async () => {
    const store = new WorkspaceTerminalStore();
    const project = { id: 'project-1', type: 'local', path: '/repo' } as const;
    const terminal: Terminal = {
      id: quickActionTerminalId(project.id, 'start'),
      projectId: project.id,
      taskId: projectTerminalScopeId(project.type, project.id),
      name: 'Start locally',
    };
    mocks.getWorkspaceTerminals.mockResolvedValue([terminal]);

    await store.prefetchProjectTerminals(project as never);

    expect(store.isOpen).toBe(false);
    expect(store.isQuickActionRunning(project as never, 'start')).toBe(false);
    await expect(store.openQuickActionTerminal(project as never, 'start')).resolves.toBe(false);
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

  it('bounds scope retention while preserving active, refreshed, and newly created scopes', async () => {
    const tabsDispose = vi.spyOn(TerminalTabViewStore.prototype, 'dispose');
    const managerDispose = vi.spyOn(TerminalManagerStore.prototype, 'dispose');
    const store = new WorkspaceTerminalStore();
    const internals = store as unknown as WorkspaceTerminalStoreInternals;
    const activeProject = { id: 'project-0', type: 'local', path: '/repo-0' } as const;

    await store.openProject(activeProject as never, { ensureTerminal: false });
    const activeScope = store.activeScope as ScopeResources;
    const createdScopes = [activeScope];

    for (let index = 1; index < WORKSPACE_TERMINAL_SCOPE_LIMIT; index += 1) {
      const projectId = `project-${index}`;
      createdScopes.push(
        internals.getOrCreateScope(projectId, projectTerminalScopeId('local', projectId), projectId)
      );
    }

    const refreshedScope = createdScopes[1];
    expect(
      internals.getOrCreateScope(
        'project-1',
        projectTerminalScopeId('local', 'project-1'),
        'project-1'
      )
    ).toBe(refreshedScope);

    const newProjectId = `project-${WORKSPACE_TERMINAL_SCOPE_LIMIT}`;
    const newScope = internals.getOrCreateScope(
      newProjectId,
      projectTerminalScopeId('local', newProjectId),
      newProjectId
    );
    createdScopes.push(newScope);
    const evictedScope = createdScopes[2];

    expect(internals.scopes.size).toBe(WORKSPACE_TERMINAL_SCOPE_LIMIT);
    expect([...internals.scopes.values()]).toContain(activeScope);
    expect([...internals.scopes.values()]).toContain(refreshedScope);
    expect([...internals.scopes.values()]).toContain(newScope);
    expect([...internals.scopes.values()]).not.toContain(evictedScope);
    expect(store.activeScope).toBe(activeScope);
    expect(tabsDispose.mock.contexts).toEqual([evictedScope.tabs]);
    expect(managerDispose.mock.contexts).toEqual([evictedScope.manager]);
    expect(tabsDispose.mock.invocationCallOrder[0]).toBeLessThan(
      managerDispose.mock.invocationCallOrder[0]
    );

    store.dispose();

    expect(internals.scopes.size).toBe(0);
    expect(store.activeScope).toBeNull();
    expect(store.isOpen).toBe(false);
    for (const scope of createdScopes) {
      expect(
        tabsDispose.mock.contexts.filter((candidate) => candidate === scope.tabs)
      ).toHaveLength(1);
      expect(
        managerDispose.mock.contexts.filter((candidate) => candidate === scope.manager)
      ).toHaveLength(1);
    }
  });
});
