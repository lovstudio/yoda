import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRuntimeActionCommand, WorkspaceShellService } from './workspace-shell-service';

const mocks = vi.hoisted(() => ({
  getDependencyManager: vi.fn(),
  getRuntimeConfig: vi.fn(),
  spawnLocalPty: vi.fn(),
  exitHandlers: [] as Array<(info: { exitCode?: number }) => void>,
}));

vi.mock('@main/core/dependencies/dependency-manager', () => ({
  getDependencyManager: mocks.getDependencyManager,
}));

vi.mock('@main/core/settings/runtime-settings-service', () => ({
  runtimeOverrideSettings: {
    getItem: mocks.getRuntimeConfig,
  },
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty: mocks.spawnLocalPty,
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('@main/utils/userEnv', () => ({ ensureUserBinDirsInPath: vi.fn() }));

describe('workspace shell runtime actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exitHandlers.length = 0;
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
    mocks.spawnLocalPty.mockReturnValue({
      onExit: vi.fn((handler) => mocks.exitHandlers.push(handler)),
      kill: vi.fn(),
    });
  });

  it('uses the detected executable and persisted default model when opening Codex', async () => {
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'open' })
    ).resolves.toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['--model', 'gpt-5.6-codex'],
    });
  });

  it('keeps only the persisted model when configured arguments contain older models', async () => {
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

  it('uses the runtime-native update action instead of the npm install command', async () => {
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'update' })
    ).resolves.toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['update'],
    });
  });

  it('keeps login actions allowlisted by runtime metadata', async () => {
    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'login' })
    ).resolves.toEqual({
      command: '/opt/homebrew/bin/codex',
      args: ['login'],
    });
  });

  it('preserves a configured executable prefix for diagnostics', async () => {
    mocks.getRuntimeConfig.mockResolvedValueOnce({ cli: 'caffeinate -i codex' });

    await expect(
      resolveRuntimeActionCommand({ runtimeId: 'codex', action: 'doctor' })
    ).resolves.toEqual({
      command: 'caffeinate',
      args: ['-i', 'codex', 'doctor'],
    });
  });

  it('does not spawn a shell when stop wins while start is awaiting', async () => {
    const service = new WorkspaceShellService();
    const sessionId = 'workspace-shell:start-race';

    const start = service.start({ sessionId });
    service.stop(sessionId);

    await start;
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
  });

  it('does not spawn a runtime action when stop wins during dependency lookup', async () => {
    let resolveManager: ((value: unknown) => void) | undefined;
    mocks.getDependencyManager.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveManager = resolve;
      })
    );
    const service = new WorkspaceShellService();
    const sessionId = 'workspace-shell:execute-race';

    const execute = service.execute(sessionId, { runtimeId: 'codex', action: 'open' });
    service.stop(sessionId);
    resolveManager?.({
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

    await execute;
    expect(mocks.spawnLocalPty).not.toHaveBeenCalled();
  });

  it('launches a runtime action with the renderer measured size and requested cwd', async () => {
    const service = new WorkspaceShellService();
    const sessionId = 'workspace-shell:measured-action';

    await service.execute(sessionId, {
      runtimeId: 'codex',
      action: 'open',
      cwd: process.cwd(),
      initialSize: { cols: 144, rows: 38 },
    });

    expect(mocks.spawnLocalPty).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: process.cwd(), cols: 144, rows: 38 })
    );
  });

  it('keeps completed runtime output instead of replacing it with a plain shell', async () => {
    const service = new WorkspaceShellService();
    await service.execute('workspace-shell:completed-action', {
      runtimeId: 'codex',
      action: 'open',
    });

    mocks.exitHandlers[0]?.({ exitCode: 0 });
    await Promise.resolve();

    expect(mocks.spawnLocalPty).toHaveBeenCalledTimes(1);
  });
});
