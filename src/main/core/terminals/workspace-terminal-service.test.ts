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
  isTerminalDetachable: vi.fn(() => true),
  killTerminal: vi.fn(async () => {}),
  destroyAll: vi.fn(async () => {}),
  detachAll: vi.fn(async () => {}),
  ptyWrite: vi.fn(),
  getPty: vi.fn(),
  getPtyDiagnostics: vi.fn(),
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
    isTerminalDetachable = mocks.isTerminalDetachable;
    killTerminal = mocks.killTerminal;
    destroyAll = mocks.destroyAll;
    detachAll = mocks.detachAll;
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: mocks.getPty, getDiagnostics: mocks.getPtyDiagnostics },
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
    expect(mocks.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal-1' }));

    await service.getTerminals('project-1', 'local:project-1:project-view');
    expect(mocks.acquireWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.getPersistedTerminals).toHaveBeenCalledTimes(1);
    expect(mocks.spawnTerminal).toHaveBeenCalledTimes(1);
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
});
