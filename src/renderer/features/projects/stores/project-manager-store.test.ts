import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { ProjectManagerStore } from './project-manager';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  prependProjectOrder: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
  rpc: {
    projects: {
      getProject: mocks.getProject,
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
      prependProjectOrder: mocks.prependProjectOrder,
      projectOrder: [],
      setProjectOrder: vi.fn(),
    },
    workspaces: {
      activeWorkspace: null,
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
  });

  it('uses project data already returned by path inspection', async () => {
    const manager = new ProjectManagerStore();
    const project = makeProject();

    const loaded = await manager.ensureProjectLoaded(project.id, project);

    expect(loaded).toBe(true);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(manager.projects.get(project.id)?.data).toEqual(project);
  });
});

function makeProject(): LocalProject {
  return {
    type: 'local',
    id: 'external-project',
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
