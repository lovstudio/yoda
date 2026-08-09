import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteProject } from './deleteProject';

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  reclaimTaskRuntime: vi.fn(),
  terminateProjectTerminals: vi.fn(),
  releaseProjectWorkspaces: vi.fn(),
  getProject: vi.fn(),
  closeProject: vi.fn(),
  deletePrData: vi.fn(),
  deleteViewState: vi.fn(),
  deleteProjectRow: vi.fn(),
  deleteWhere: vi.fn(),
  emit: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn(() => 'project-id-predicate') }));
vi.mock('@main/core/tasks/operations/getTasks', () => ({ getTasks: mocks.getTasks }));
vi.mock('@main/core/pty/tmux-session-name', () => ({
  listTmuxSessionMarkersStrict: mocks.listTmuxSessionMarkersStrict,
}));
vi.mock('@main/core/tasks/task-runtime-reclamation', () => ({
  reclaimTaskRuntime: mocks.reclaimTaskRuntime,
}));
vi.mock('@main/core/terminals/workspace-terminal-service', () => ({
  workspaceTerminalService: { terminateProject: mocks.terminateProjectTerminals },
}));
vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { releaseAllForProject: mocks.releaseProjectWorkspaces },
}));
vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject, closeProject: mocks.closeProject },
}));
vi.mock('@main/core/pull-requests/pr-sync-engine', () => ({
  prSyncEngine: { deleteProjectData: mocks.deletePrData },
}));
vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: { del: mocks.deleteViewState },
}));
vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { _emit: mocks.emit },
}));
vi.mock('@main/db/client', () => ({ db: { delete: mocks.deleteProjectRow } }));
vi.mock('@main/db/schema', () => ({ projects: { id: 'id' } }));
vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTasks.mockResolvedValue([]);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    mocks.reclaimTaskRuntime.mockResolvedValue({ confirmed: true, failures: [] });
    mocks.terminateProjectTerminals.mockResolvedValue(undefined);
    mocks.releaseProjectWorkspaces.mockResolvedValue(undefined);
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: {} });
    mocks.closeProject.mockResolvedValue({ success: true, data: undefined });
    mocks.deletePrData.mockResolvedValue(undefined);
    mocks.deleteViewState.mockResolvedValue(undefined);
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.deleteProjectRow.mockReturnValue({ where: mocks.deleteWhere });
  });

  it('terminates runtime ownership before the project row cascade with bounded task cleanup', async () => {
    mocks.getTasks.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({ id: `task-${index}` }))
    );
    let active = 0;
    let maxActive = 0;
    const inventories = new Set<Set<string>>();
    mocks.reclaimTaskRuntime.mockImplementation(async (_projectId, _taskId, _ctx, options) => {
      inventories.add(options.liveTmuxSessionNames);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { confirmed: true, failures: [] };
    });

    await deleteProject('project-1');

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(1);
    expect(mocks.reclaimTaskRuntime).toHaveBeenCalledTimes(12);
    expect(inventories.size).toBe(1);
    expect(maxActive).toBe(4);
    expect(mocks.terminateProjectTerminals).toHaveBeenCalledWith('project-1');
    expect(mocks.releaseProjectWorkspaces).toHaveBeenCalledWith('project-1', 'terminate');
    expect(mocks.closeProject).toHaveBeenCalledWith('project-1', { mode: 'terminate' });
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteProjectRow.mock.invocationCallOrder[0]
    );
    expect(mocks.deleteViewState).toHaveBeenCalledWith('project:project-1');
    expect(mocks.emit).toHaveBeenCalledWith('project:deleted', 'project-1');
  });

  it('does not delete persisted ownership or emit completion when close fails', async () => {
    mocks.closeProject.mockResolvedValue({
      success: false,
      error: { type: 'error', message: 'provider still running' },
    });

    await expect(deleteProject('project-1')).rejects.toThrow('provider still running');

    expect(mocks.deletePrData).not.toHaveBeenCalled();
    expect(mocks.deleteProjectRow).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('does not claim deletion when workspace reclamation fails', async () => {
    mocks.releaseProjectWorkspaces.mockRejectedValue(new Error('workspace cleanup failed'));

    await expect(deleteProject('project-1')).rejects.toThrow('workspace cleanup failed');

    expect(mocks.closeProject).not.toHaveBeenCalled();
    expect(mocks.deletePrData).not.toHaveBeenCalled();
    expect(mocks.deleteProjectRow).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('fails closed when the project runtime is unavailable', async () => {
    mocks.getProject.mockReturnValue(undefined);

    await expect(deleteProject('project-1')).rejects.toThrow('runtime is unavailable');

    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.deleteProjectRow).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
