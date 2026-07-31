import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
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

  it('is disabled by default and does not filter tasks while retaining selection', () => {
    const store = new WorkspaceStore();

    store.setActiveWorkspaceId('workspace-1');

    expect(store.enabled).toBe(false);
    expect(store.activeWorkspaceId).toBe('workspace-1');
    expect(store.isFiltering).toBe(false);
    expect(store.matchesActive(null)).toBe(true);
    expect(store.matchesActive('workspace-1')).toBe(true);
  });

  it('returns to the previous workspace after disabling and re-enabling', () => {
    const store = new WorkspaceStore();

    store.setEnabled(true);
    store.setActiveWorkspaceId('workspace-1');
    store.setEnabled(false);

    expect(store.activeWorkspaceId).toBe('workspace-1');
    expect(store.isFiltering).toBe(false);
    expect(store.matchesActive(null)).toBe(true);
    expect(store.matchesActive('workspace-1')).toBe(true);

    store.setEnabled(true);

    expect(store.activeWorkspaceId).toBe('workspace-1');
    expect(store.isFiltering).toBe(true);
    expect(store.matchesActive(null)).toBe(false);
    expect(store.matchesActive('workspace-1')).toBe(true);
  });

  it('keeps unassigned tasks in the Default workspace when enabled', () => {
    const store = new WorkspaceStore();

    store.setActiveWorkspaceId(DEFAULT_WORKSPACE_ID);
    store.setEnabled(true);

    expect(store.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(store.isFiltering).toBe(true);
    expect(store.matchesActive(null)).toBe(true);
    expect(store.matchesActive(undefined)).toBe(true);
    expect(store.matchesActive('workspace-1')).toBe(false);
  });

  it('restores workspace selection even when the feature starts disabled', async () => {
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

    expect(store.enabled).toBe(false);
    expect(store.activeWorkspaceId).toBe('workspace-1');
    expect(store.isFiltering).toBe(false);
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
