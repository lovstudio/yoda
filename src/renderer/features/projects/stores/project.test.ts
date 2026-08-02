import { describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import { MountedProject } from './project';

const mocks = vi.hoisted(() => ({
  disposeTaskManager: vi.fn(),
  disposeRepository: vi.fn(),
  disposeSettings: vi.fn(),
  disposePrSync: vi.fn(),
  disposeSnapshot: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-manager', () => ({
  TaskManagerStore: class {
    dispose = mocks.disposeTaskManager;
  },
}));

vi.mock('@renderer/lib/stores/snapshot-registry', () => ({
  snapshotRegistry: {
    register: vi.fn(() => mocks.disposeSnapshot),
  },
}));

vi.mock('./repository-store', () => ({
  RepositoryStore: class {
    dispose = mocks.disposeRepository;
  },
}));

vi.mock('./project-settings-store', () => ({
  ProjectSettingsStore: class {
    dispose = mocks.disposeSettings;
  },
}));

vi.mock('./pr-sync-store', () => ({
  PrSyncStore: class {
    dispose = mocks.disposePrSync;
  },
}));

vi.mock('./project-view', () => ({
  ProjectViewStore: class {
    readonly snapshot = {};
    restoreSnapshot = vi.fn();
  },
}));

const project: LocalProject = {
  type: 'local',
  id: 'project-1',
  name: 'Project',
  alias: null,
  path: '/repo',
  baseRef: 'main',
  workspaceId: null,
  isInternal: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('MountedProject disposal', () => {
  it('disposes task state before its project dependencies', () => {
    const mounted = new MountedProject(project);

    mounted.dispose();

    expect(mocks.disposeTaskManager).toHaveBeenCalledOnce();
    expect(mocks.disposeRepository).toHaveBeenCalledOnce();
    expect(mocks.disposeSettings).toHaveBeenCalledOnce();
    expect(mocks.disposePrSync).toHaveBeenCalledOnce();
    expect(mocks.disposeSnapshot).toHaveBeenCalledOnce();
    expect(mocks.disposeTaskManager.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.disposeRepository.mock.invocationCallOrder[0]
    );
  });
});
