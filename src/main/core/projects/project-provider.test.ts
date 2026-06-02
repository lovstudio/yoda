import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';

const mocks = vi.hoisted(() => ({
  releaseAllForProject: vi.fn(),
  teardownAllForProject: vi.fn(),
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

function createProvider(tmux: boolean): ProjectProvider {
  const settings = {
    get: vi.fn(async () => ({ tmux })),
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
  });

  it('uses terminate mode from project settings when tmux is disabled', async () => {
    await createProvider(false).dispose();

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'terminate');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'terminate');
  });

  it('uses detach mode from project settings when tmux is enabled', async () => {
    await createProvider(true).dispose();

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'detach');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'detach');
  });

  it('can force detach mode for app shutdown', async () => {
    await createProvider(false).dispose({ mode: 'detach' });

    expect(mocks.teardownAllForProject).toHaveBeenCalledWith('project-1', 'detach');
    expect(mocks.releaseAllForProject).toHaveBeenCalledWith('project-1', 'detach');
  });
});
