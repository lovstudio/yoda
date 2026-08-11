import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBAL_TERMINAL_PROJECT_ID, GLOBAL_TERMINAL_SCOPE_ID } from '@shared/terminals';
import {
  resolveRuntimeActionCommand,
  WorkspaceTerminalService,
} from './workspace-terminal-service';

const mocks = vi.hoisted(() => ({
  getDependencyManager: vi.fn(),
  getRuntimeConfig: vi.fn(),
  spawnTerminal: vi.fn(async () => {}),
  spawnLifecycleScript: vi.fn(async () => {}),
  isTerminalDetachable: vi.fn(() => true),
  killTerminal: vi.fn(async () => {}),
  destroyAll: vi.fn(async () => {}),
  detachAll: vi.fn(async () => {}),
  ptyWrite: vi.fn(),
  getPty: vi.fn(),
  getPtyDiagnostics: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  killTmuxSessionStrict: vi.fn(),
  getProject: vi.fn(),
  getWorkspace: vi.fn(),
  acquireWorkspace: vi.fn(),
  releaseWorkspace: vi.fn(),
  getPersistedTerminals: vi.fn(),
  persistTerminal: vi.fn(),
  deletePersistedTerminal: vi.fn(),
  renamePersistedTerminal: vi.fn(),
}));

vi.mock('@main/core/dependencies/dependency-manager', () => ({
  getDependencyManager: mocks.getDependencyManager,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: { getItem: mocks.getRuntimeConfig },
}));

vi.mock('@main/core/terminals/impl/local-terminal-provider', () => ({
  LocalTerminalProvider: class {
    spawnTerminal = mocks.spawnTerminal;
    spawnLifecycleScript = mocks.spawnLifecycleScript;
    isTerminalDetachable = mocks.isTerminalDetachable;
    killTerminal = mocks.killTerminal;
    destroyAll = mocks.destroyAll;
    detachAll = mocks.detachAll;
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: mocks.getPty, getDiagnostics: mocks.getPtyDiagnostics },
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  makeTmuxSessionName: (sessionId: string) => `tmux:${sessionId}`,
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
  killTmuxSessionStrict: mocks.killTmuxSessionStrict,
}));

vi.mock('@main/core/terminals/workspace-terminal-persistence', () => ({
  getPersistedWorkspaceTerminals: mocks.getPersistedTerminals,
  persistWorkspaceTerminal: mocks.persistTerminal,
  deletePersistedWorkspaceTerminal: mocks.deletePersistedTerminal,
  renamePersistedWorkspaceTerminal: mocks.renamePersistedTerminal,
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { get: mocks.getWorkspace, release: mocks.releaseWorkspace },
}));

vi.mock('@main/core/workspaces/project-view-workspace', () => ({
  acquireProjectViewWorkspace: mocks.acquireWorkspace,
  projectViewWorkspaceIdForProvider: (project: { projectId: string }) =>
    `local:${project.projectId}:project-view`,
}));

describe('WorkspaceTerminalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDependencyManager.mockResolvedValue({
      get: vi.fn(() => ({
        id: 'codex',
        category: 'agent',
        status: 'available',
        version: '0.144.1',
        path: '/opt/homebrew/bin/codex',
        checkedAt: 1,
      })),
      probe: vi.fn(),
    });
    mocks.getRuntimeConfig.mockResolvedValue({ cli: 'codex', defaultModel: 'gpt-5.6-codex' });
    mocks.getPty.mockReturnValue({ write: mocks.ptyWrite });
    mocks.getPtyDiagnostics.mockReturnValue({ tmuxBacked: true });
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    mocks.killTmuxSessionStrict.mockResolvedValue(undefined);
    mocks.getPersistedTerminals.mockResolvedValue([]);
    mocks.persistTerminal.mockImplementation(async (terminal) => terminal);
    mocks.deletePersistedTerminal.mockResolvedValue(undefined);
    mocks.renamePersistedTerminal.mockResolvedValue(undefined);
    mocks.acquireWorkspace.mockImplementation(async () => mocks.getWorkspace());
    mocks.releaseWorkspace.mockResolvedValue(undefined);
  });

  it('uses the detected executable and persisted model for runtime actions', async () => {
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'open' })
    ).resolves.toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['--model', 'gpt-5.6-codex'],
    });
  });

  it('normalizes configured model arguments to the persisted model', async () => {
    mocks.getRuntimeConfig.mockResolvedValueOnce({
      cli: 'codex -m cli-model',
      defaultArgs: ['-m=default-args-model'],
      defaultModel: 'persisted-model',
      extraArgs: '-m extra-args-model',
    });

    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'open' })
    ).resolves.toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['--model', 'persisted-model'],
    });
  });

  it('keeps update, login, and diagnostic commands allowlisted by runtime metadata', async () => {
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'update' })
    ).resolves.toEqual({ command: '/opt/homebrew/bin/codex', args: ['update'] });
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'login' })
    ).resolves.toEqual({ command: '/opt/homebrew/bin/codex', args: ['login'] });

    mocks.getRuntimeConfig.mockResolvedValueOnce({ cli: 'caffeinate -i codex' });
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'doctor' })
    ).resolves.toEqual({ command: 'caffeinate', args: ['-i', 'codex', 'doctor'] });
  });

  it('creates task-free project terminals through the project workspace provider', async () => {
    const projectProvider = { projectId: 'project-1' };
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue(projectProvider);
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    const service = new WorkspaceTerminalService();

    await expect(
      service.createTerminal({
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Terminal 1',
      })
    ).resolves.toMatchObject({ id: 'terminal-1', taskId: 'local:project-1:project-view' });

    expect(mocks.spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1' }),
      undefined
    );
    expect(mocks.persistTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1', projectId: 'project-1' })
    );
  });

  it('runs one-shot project commands without persisting a stale quick-action terminal', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      spawnLifecycleScript: mocks.spawnLifecycleScript,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    const service = new WorkspaceTerminalService();

    await service.createTerminal({
      id: 'quick-action-1',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'Start locally',
      command: ' pnpm run dev ',
      persist: false,
    });

    expect(mocks.spawnTerminal).not.toHaveBeenCalled();
    expect(mocks.spawnLifecycleScript).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ id: 'quick-action-1' }),
        command: 'pnpm run dev',
        respawnOnExit: false,
        preserveBufferOnExit: true,
        watchDevServer: true,
      })
    );
    expect(mocks.persistTerminal).not.toHaveBeenCalled();
  });

  it('hydrates persisted project terminals so tmux sessions can be reattached', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    mocks.getPersistedTerminals.mockResolvedValue([
      {
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Start locally',
      },
    ]);
    const service = new WorkspaceTerminalService();

    await expect(
      service.getTerminals('project-1', 'local:project-1:project-view')
    ).resolves.toEqual([expect.objectContaining({ id: 'terminal-1', name: 'Start locally' })]);
    expect(mocks.spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal-1' }),
      undefined,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 15_000 })
    );

    await service.getTerminals('project-1', 'local:project-1:project-view');
    expect(mocks.acquireWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.getPersistedTerminals).toHaveBeenCalledTimes(1);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
  });

  it('rolls back provider tracking and persistence when project terminal creation fails', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    mocks.spawnTerminal.mockRejectedValueOnce(new Error('SSH channel failed'));
    const service = new WorkspaceTerminalService();

    await expect(
      service.createTerminal({
        id: 'terminal-failed',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Terminal 1',
      })
    ).rejects.toThrow('SSH channel failed');

    expect(mocks.killTerminal).toHaveBeenCalledWith('terminal-failed');
    expect(mocks.deletePersistedTerminal).toHaveBeenCalledWith(
      'project-1',
      'local:project-1:project-view',
      'terminal-failed'
    );
    expect(service.getActiveSessionSummary()).toMatchObject({ running: 0 });
  });

  it('keeps persisted terminals visible when a hydration attempt fails', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    mocks.getPersistedTerminals.mockResolvedValue([
      {
        id: 'terminal-offline',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Reconnect me',
      },
    ]);
    mocks.spawnTerminal.mockRejectedValueOnce(new Error('connection unavailable'));
    const service = new WorkspaceTerminalService();

    await expect(
      service.getTerminals('project-1', 'local:project-1:project-view')
    ).resolves.toEqual([expect.objectContaining({ id: 'terminal-offline' })]);
  });

  it('summarizes tmux-backed project terminals for the app quit decision', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    const service = new WorkspaceTerminalService();
    await service.createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'Start locally',
    });

    expect(service.getActiveSessionSummary()).toMatchObject({ running: 1, keepable: 1 });
    await service.dispose('detach');
    expect(mocks.detachAll).toHaveBeenCalledTimes(1);
  });

  it('types allowlisted runtime commands into a standard global terminal', async () => {
    const service = new WorkspaceTerminalService();
    await service.createTerminal({
      id: 'runtime-1',
      projectId: GLOBAL_TERMINAL_PROJECT_ID,
      taskId: GLOBAL_TERMINAL_SCOPE_ID,
      name: 'Codex',
    });

    await service.runRuntimeAction('runtime-1', { runtimeId: 'codex', action: 'doctor' });

    expect(mocks.ptyWrite).toHaveBeenCalledWith('/opt/homebrew/bin/codex doctor\r');
  });

  it('rejects project terminal scopes that do not match the project-view workspace', async () => {
    mocks.getProject.mockReturnValue({ projectId: 'project-1' });
    const service = new WorkspaceTerminalService();

    await expect(
      service.createTerminal({
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'task-1',
        name: 'Terminal 1',
      })
    ).rejects.toThrow('Invalid project Terminal scope');
    expect(mocks.spawnTerminal).not.toHaveBeenCalled();
  });

  it('terminates and forgets every terminal for one project without touching global terminals', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    const projectContext = {};
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: projectContext });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    mocks.getPersistedTerminals.mockResolvedValue([
      {
        id: 'persisted-only',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Persisted',
      },
    ]);
    mocks.listTmuxSessionMarkersStrict
      .mockResolvedValueOnce([
        {
          sessionName: 'tmux:project-1:local:project-1:project-view:persisted-only',
          cwd: '/repo',
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.killTmuxSessionStrict.mockRejectedValueOnce(new Error('session exited during kill'));
    const service = new WorkspaceTerminalService();
    await service.createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'One',
    });
    await service.createTerminal({
      id: 'terminal-2',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'Two',
    });
    await service.createTerminal({
      id: 'global-1',
      projectId: GLOBAL_TERMINAL_PROJECT_ID,
      taskId: GLOBAL_TERMINAL_SCOPE_ID,
      name: 'Global',
    });

    await service.terminateProject('project-1');

    expect(mocks.destroyAll).toHaveBeenCalledTimes(1);
    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(2);
    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledWith(projectContext);
    expect(mocks.killTmuxSessionStrict).toHaveBeenCalledWith(
      projectContext,
      'tmux:project-1:local:project-1:project-view:persisted-only'
    );
    expect(mocks.deletePersistedTerminal).not.toHaveBeenCalled();
    expect(mocks.releaseWorkspace).toHaveBeenCalledWith(
      'local:project-1:project-view',
      'terminate'
    );
    expect(service.getActiveSessionSummary()).toMatchObject({ running: 1 });
  });

  it('waits for an in-flight terminal creation before reclaiming the project', async () => {
    let resolveSpawn: (() => void) | undefined;
    mocks.spawnTerminal.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSpawn = resolve;
        })
    );
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: {} });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    const service = new WorkspaceTerminalService();
    const creation = service.createTerminal({
      id: 'terminal-late',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'Late',
    });
    await vi.waitFor(() => expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1));

    const termination = service.terminateProject('project-1');
    await Promise.resolve();
    expect(mocks.destroyAll).not.toHaveBeenCalled();
    resolveSpawn?.();

    await expect(creation).resolves.toMatchObject({ id: 'terminal-late' });
    await expect(termination).resolves.toBeUndefined();
    expect(mocks.destroyAll).toHaveBeenCalledTimes(1);
    expect(mocks.deletePersistedTerminal).not.toHaveBeenCalled();
    expect(service.getActiveSessionSummary()).toMatchObject({ running: 0 });
  });

  it('fails closed and preserves terminal identity when authoritative tmux listing fails', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: {} });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    mocks.getPersistedTerminals.mockResolvedValue([
      {
        id: 'terminal-cold',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Cold',
      },
    ]);
    mocks.listTmuxSessionMarkersStrict.mockRejectedValue(new Error('SSH transport failed'));
    const service = new WorkspaceTerminalService();
    await service.getTerminals('project-1', 'local:project-1:project-view');

    await expect(service.terminateProject('project-1')).rejects.toThrow('SSH transport failed');

    expect(mocks.deletePersistedTerminal).not.toHaveBeenCalled();
    expect(mocks.releaseWorkspace).not.toHaveBeenCalled();
    await expect(
      service.createTerminal({
        id: 'terminal-blocked',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Blocked',
      })
    ).rejects.toThrow('being terminated');
  });

  it('fails closed when a cold terminal remains live after a strict kill failure', async () => {
    const projectContext = {};
    const sessionName = 'tmux:project-1:local:project-1:project-view:terminal-cold';
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: projectContext });
    mocks.getPersistedTerminals.mockResolvedValue([
      {
        id: 'terminal-cold',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Cold',
      },
    ]);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([{ sessionName, cwd: '/repo' }]);
    mocks.killTmuxSessionStrict.mockRejectedValue(new Error('kill transport failed'));
    const service = new WorkspaceTerminalService();

    await expect(service.terminateProject('project-1')).rejects.toThrow(
      'Failed to terminate 1 of 1'
    );

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(2);
    expect(mocks.killTmuxSessionStrict).toHaveBeenCalledWith(projectContext, sessionName);
    expect(mocks.deletePersistedTerminal).not.toHaveBeenCalled();
    expect(mocks.releaseWorkspace).not.toHaveBeenCalled();
  });

  it('coalesces concurrent termination and stays fail-closed until cleanup is retried', async () => {
    const terminalProvider = {
      spawnTerminal: mocks.spawnTerminal,
      isTerminalDetachable: mocks.isTerminalDetachable,
      killTerminal: mocks.killTerminal,
      destroyAll: mocks.destroyAll,
      detachAll: mocks.detachAll,
    };
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: {} });
    mocks.getWorkspace.mockReturnValue({ terminals: terminalProvider });
    const service = new WorkspaceTerminalService();
    await service.createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'local:project-1:project-view',
      name: 'One',
    });
    mocks.destroyAll.mockRejectedValueOnce(new Error('destroy failed'));

    const first = service.terminateProject('project-1');
    const second = service.terminateProject('project-1');
    await expect(Promise.all([first, second])).rejects.toThrow('Failed to clean up');
    expect(mocks.destroyAll).toHaveBeenCalledTimes(1);
    await expect(
      service.createTerminal({
        id: 'terminal-blocked',
        projectId: 'project-1',
        taskId: 'local:project-1:project-view',
        name: 'Blocked',
      })
    ).rejects.toThrow('being terminated');

    await expect(service.terminateProject('project-1')).resolves.toBeUndefined();
    expect(mocks.destroyAll).toHaveBeenCalledTimes(2);
    expect(service.getActiveSessionSummary()).toMatchObject({ running: 0 });
  });
});
