import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_WORKSPACES_ID, DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { WorkspaceStore } from './workspace-store';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    appSettings: {
      get: mocks.getSettings,
    },
    workspaces: {
      listWorkspaces: mocks.listWorkspaces,
    },
  },
}));

describe('WorkspaceStore feature setting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({ workspacesEnabled: false });
  });

  it('is disabled by default and does not filter tasks', () => {
    const store = new WorkspaceStore();

    store.setActiveWorkspaceId('workspace-1');

    expect(store.enabled).toBe(false);
    expect(store.activeWorkspaceId).toBe(ALL_WORKSPACES_ID);
    expect(store.isFiltering).toBe(false);
    expect(store.matchesActive(null)).toBe(true);
    expect(store.matchesActive('workspace-1')).toBe(true);
  });

  it('opens the Default workspace when enabled and includes unassigned tasks', () => {
    const store = new WorkspaceStore();

    store.setEnabled(true);

    expect(store.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(store.isFiltering).toBe(true);
    expect(store.matchesActive(null)).toBe(true);
    expect(store.matchesActive(undefined)).toBe(true);
    expect(store.matchesActive('workspace-1')).toBe(false);
  });

  it('loads the persisted setting before restoring workspace selection', async () => {
    mocks.getSettings.mockResolvedValue({ workspacesEnabled: true });
    mocks.listWorkspaces.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Workspace 1',
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const store = new WorkspaceStore();

    await store.load();
    store.restoreActiveWorkspaceId('workspace-1');

    expect(store.enabled).toBe(true);
    expect(store.activeWorkspaceId).toBe('workspace-1');
    expect(store.activeWorkspace?.name).toBe('Workspace 1');
  });
});
