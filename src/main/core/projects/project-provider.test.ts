import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';

const mocks = vi.hoisted(() => ({
  getAppSetting: vi.fn(),
  releaseAllForProject: vi.fn(),
  teardownAllForProject: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getAppSetting,
  },
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    teardownAllForProject: mocks.teardownAllForProject,
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    releaseAllForProject: mocks.releaseAllForProject,
  },
}));

function createProvider(): ProjectProvider {
  const settings = {
    get: vi.fn(async () => ({})),
  };
  const transport = {
    kind: 'local',
    defaultWorkspaceType: { kind: 'local' },
    ctx: {},
    authCtx: {},
    fs: {},
    settings,
    worktreeHost: {},
    worktreePoolPath: '/worktrees',
  } as unknown as ProjectProviderTransport;

  return new ProjectProvider(
    'project-1',
    '/repo',
    transport,
    {} as ConstructorParameters<typeof ProjectProvider>[3],
    {} as ConstructorParameters<typeof ProjectProvider>[4],
    { stop: vi.fn() } as unknown as ConstructorParameters<typeof ProjectProvider>[5],
    vi.fn()
  );
}

describe('ProjectProvider dispose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppSetting.mockResolvedValue({ tmuxByDefault: false });
  });

  it('uses terminate mode from global settings when tmux is disabled', async () => {
    mocks.getAppSetting.mockResolvedValue({ tmuxByDefault: false });

    await createProvider().dispose();

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'terminate');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'terminate');
  });

  it('uses detach mode from global settings when tmux is enabled', async () => {
    mocks.getAppSetting.mockResolvedValue({ tmuxByDefault: true });

    await createProvider().dispose();

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'detach');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'detach');
  });

  it('can force detach mode for app shutdown', async () => {
    await createProvider().dispose({ mode: 'detach' });

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'detach');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'detach');
  });
});
