import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { createUnmountedProject } from './project';
import { ProjectManagerStore } from './project-manager';

const mocks = vi.hoisted(() => ({
  archiveProject: vi.fn(),
  deleteProject: vi.fn(),
  ensureProjectExpanded: vi.fn(),
  getProjects: vi.fn(),
  getProject: vi.fn(),
  openProject: vi.fn(),
  prependProjectOrder: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    projects: {
      archiveProject: mocks.archiveProject,
      deleteProject: mocks.deleteProject,
      getProjects: mocks.getProjects,
      getProject: mocks.getProject,
      openProject: mocks.openProject,
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      viewParamsStore: {},
    },
    sidebar: {
      ensureProjectExpanded: mocks.ensureProjectExpanded,
      prependProjectOrder: mocks.prependProjectOrder,
      projectOrder: [],
      pinnedProjectIds: new Set<string>(),
      projectActivityById: {},
      setProjectOrder: vi.fn(),
    },
    agentRuntime: {
      forgetProject: vi.fn(),
    },
    workspaces: {
      activeWorkspace: null,
      matchesActive: vi.fn(() => true),
    },
  },
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: vi.fn(),
  },
}));

vi.mock('@renderer/features/workspaces/project-workspace-conflict', () => ({
  resolveProjectWorkspaceConflict: vi.fn(),
}));

vi.mock('@renderer/utils/telemetryClient', () => ({
  captureTelemetry: vi.fn(),
}));

describe('ProjectManagerStore external project reconciliation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads a project added after the initial renderer snapshot', async () => {
    const manager = new ProjectManagerStore();
    const project = makeProject();
    mocks.getProject.mockResolvedValue(project);

    const loaded = await manager.ensureProjectLoaded(project.id);

    expect(loaded).toBe(true);
    expect(mocks.getProject).toHaveBeenCalledWith(project.id);
    expect(manager.projects.get(project.id)?.data).toEqual(project);
    expect(manager.projects.get(project.id)?.phase).toBe('idle');
    expect(mocks.prependProjectOrder).toHaveBeenCalledWith(project.id);
    expect(mocks.ensureProjectExpanded).toHaveBeenCalledWith(project.id);
  });

  it('loads project metadata without mounting every project', async () => {
    const manager = new ProjectManagerStore();
    const project = makeProject();
    mocks.getProjects.mockResolvedValue([project]);

    await manager.load();

    expect(manager.projects.get(project.id)?.phase).toBe('idle');
    expect(mocks.openProject).not.toHaveBeenCalled();
  });

  it('mounts only a bounded initial working set', async () => {
    const manager = new ProjectManagerStore();
    for (let index = 0; index < 12; index += 1) {
      const project = makeProject(`project-${index}`);
      manager.projects.set(project.id, createUnmountedProject(project, 'idle'));
    }
    const mountProject = vi.spyOn(manager, 'mountProject').mockResolvedValue(undefined);

    await manager.mountInitialProjects();

    expect(mountProject).toHaveBeenCalledTimes(8);
  });

  it('uses project data already returned by path inspection', async () => {
    const manager = new ProjectManagerStore();
    const project = makeProject();

    const loaded = await manager.ensureProjectLoaded(project.id, project);

    expect(loaded).toBe(true);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(manager.projects.get(project.id)?.data).toEqual(project);
  });

  it('expands a project that is already loaded', async () => {
    const manager = new ProjectManagerStore();
    const project = makeProject();
    await manager.ensureProjectLoaded(project.id, project);
    vi.clearAllMocks();

    const loaded = await manager.ensureProjectLoaded(project.id);

    expect(loaded).toBe(true);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.ensureProjectExpanded).toHaveBeenCalledWith(project.id);
  });
});

describe('ProjectManagerStore mounted project cleanup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('disposes mounted resources after a project is deleted', async () => {
    const manager = new ProjectManagerStore();
    const dispose = vi.fn();
    const store = {
      mountedProject: { dispose },
    } as never;
    manager.projects.set('project-1', store);
    mocks.deleteProject.mockResolvedValue(undefined);

    await manager.deleteProject('project-1');

    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.projects.has('project-1')).toBe(false);
  });

  it('keeps mounted resources alive when archiving fails so rollback remains usable', async () => {
    const manager = new ProjectManagerStore();
    const dispose = vi.fn();
    const store = {
      mountedProject: { dispose },
    } as never;
    manager.projects.set('project-1', store);
    mocks.archiveProject.mockRejectedValue(new Error('archive failed'));

    await expect(manager.archiveProject('project-1')).rejects.toThrow('archive failed');

    expect(dispose).not.toHaveBeenCalled();
    expect(manager.projects.get('project-1')).toBeDefined();
  });
});

function makeProject(id = 'external-project'): LocalProject {
  return {
    type: 'local',
    id,
    name: 'External project',
    alias: null,
    path: '/tmp/external-project',
    baseRef: 'main',
    workspaceId: null,
    isInternal: false,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}
