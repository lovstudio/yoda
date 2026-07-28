import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiLabProject } from './create-ai-lab-project';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  mountProject: vi.fn(),
  projects: new Map<string, object>(),
  prepareQuickProject: vi.fn(),
  scaffoldAppProject: vi.fn(),
  asMounted: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: () => ({
    createProject: mocks.createProject,
    mountProject: mocks.mountProject,
    projects: mocks.projects,
  }),
  asMounted: mocks.asMounted,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    projects: {
      prepareQuickProject: mocks.prepareQuickProject,
    },
    aiLab: {
      scaffoldAppProject: mocks.scaffoldAppProject,
    },
  },
}));

describe('createAiLabProject', () => {
  beforeEach(() => {
    mocks.createProject.mockReset();
    mocks.mountProject.mockReset();
    mocks.prepareQuickProject.mockReset();
    mocks.scaffoldAppProject.mockReset();
    mocks.asMounted.mockReset();
    mocks.projects.clear();
  });

  it('creates and mounts a dedicated local Git project', async () => {
    const mounted = {
      data: { type: 'local', id: 'app-project', baseRef: 'main' },
      taskManager: {},
    };
    const store = {};
    mocks.projects.set('app-project', store);
    mocks.prepareQuickProject.mockResolvedValue({
      name: 'Trip planner',
      path: '/projects/trip-planner',
    });
    mocks.createProject.mockResolvedValue('app-project');
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.asMounted.mockReturnValue(mounted);
    mocks.scaffoldAppProject.mockResolvedValue(undefined);

    await expect(createAiLabProject('Trip planner')).resolves.toBe(mounted);
    expect(mocks.createProject).toHaveBeenCalledWith(
      { type: 'local' },
      {
        mode: 'pick',
        name: 'Trip planner',
        path: '/projects/trip-planner',
        initGitRepository: true,
      }
    );
    expect(mocks.mountProject).toHaveBeenCalledWith('app-project');
    expect(mocks.asMounted).toHaveBeenCalledWith(store);
    expect(mocks.scaffoldAppProject).toHaveBeenCalledWith({
      projectId: 'app-project',
      name: 'Trip planner',
    });
  });
});
