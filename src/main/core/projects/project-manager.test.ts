import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { ProjectManager } from './project-manager';
import type { ProjectProvider } from './project-provider';

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  logError: vi.fn(),
  releaseAllForProject: vi.fn(),
  teardownAllForProject: vi.fn(),
}));

vi.mock('./create-project-provider', () => ({
  createProvider: mocks.createProvider,
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: mocks.logError,
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

const project: LocalProject = {
  type: 'local',
  id: 'project-1',
  name: 'Project',
  alias: null,
  path: '/repo',
  baseRef: 'main',
  isInternal: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ProjectManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes forced detach mode to project providers during bulk dispose', async () => {
    const provider = {
      dispose: vi.fn(async () => {}),
    } as unknown as ProjectProvider;
    mocks.createProvider.mockResolvedValue(provider);
    const manager = new ProjectManager();

    await manager.openProject(project);
    await manager.dispose({ mode: 'detach' });

    expect(provider.dispose).toHaveBeenCalledWith({ mode: 'detach' });
  });
});
