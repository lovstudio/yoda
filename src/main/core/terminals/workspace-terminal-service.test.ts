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
  killTerminal: vi.fn(async () => {}),
  ptyWrite: vi.fn(),
  getPty: vi.fn(),
  getProject: vi.fn(),
  getWorkspace: vi.fn(),
  acquireWorkspace: vi.fn(),
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
    killTerminal = mocks.killTerminal;
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: { get: mocks.getPty },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { get: mocks.getWorkspace },
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
      killTerminal: mocks.killTerminal,
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
