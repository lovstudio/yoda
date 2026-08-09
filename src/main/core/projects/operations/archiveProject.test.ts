import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveProject } from './archiveProject';

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  listTmuxSessionMarkersStrict: vi.fn(),
  reclaimTaskRuntime: vi.fn(),
  terminateProjectTerminals: vi.fn(),
  releaseProjectWorkspaces: vi.fn(),
  getProject: vi.fn(),
  closeProject: vi.fn(),
  updateProject: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  emit: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'project-id-predicate'),
  sql: vi.fn(() => 'current-timestamp'),
}));

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
vi.mock('@main/core/projects/project-events', () => ({
  projectEvents: { _emit: mocks.emit },
}));
vi.mock('@main/db/client', () => ({ db: { update: mocks.updateProject } }));
vi.mock('@main/db/schema', () => ({ projects: { id: 'id' } }));
vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

describe('archiveProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTasks.mockResolvedValue([]);
    mocks.listTmuxSessionMarkersStrict.mockResolvedValue([]);
    mocks.reclaimTaskRuntime.mockResolvedValue({ confirmed: true, failures: [] });
    mocks.terminateProjectTerminals.mockResolvedValue(undefined);
    mocks.releaseProjectWorkspaces.mockResolvedValue(undefined);
    mocks.getProject.mockReturnValue({ projectId: 'project-1', ctx: {} });
    mocks.closeProject.mockResolvedValue({ success: true, data: undefined });
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateProject.mockReturnValue({ set: mocks.updateSet });
  });

  it('uses bounded task cleanup and terminates all runtime ownership before archiving', async () => {
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

    await archiveProject('project-1');

    expect(mocks.listTmuxSessionMarkersStrict).toHaveBeenCalledTimes(1);
    expect(mocks.reclaimTaskRuntime).toHaveBeenCalledTimes(12);
    expect(inventories.size).toBe(1);
    expect(maxActive).toBe(4);
    expect(mocks.terminateProjectTerminals).toHaveBeenCalledWith('project-1');
    expect(mocks.releaseProjectWorkspaces).toHaveBeenCalledWith('project-1', 'terminate');
    expect(mocks.closeProject).toHaveBeenCalledWith('project-1', { mode: 'terminate' });
    expect(mocks.closeProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateProject.mock.invocationCallOrder[0]
    );
    expect(mocks.emit).toHaveBeenCalledWith('project:archived', 'project-1');
  });

  it('does not mutate the project or emit completion when runtime cleanup fails', async () => {
    mocks.terminateProjectTerminals.mockRejectedValue(new Error('terminal cleanup failed'));

    await expect(archiveProject('project-1')).rejects.toThrow('terminal cleanup failed');

    expect(mocks.releaseProjectWorkspaces).not.toHaveBeenCalled();
    expect(mocks.closeProject).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('treats unconfirmed task runtime reclamation as a project cleanup failure', async () => {
    mocks.getTasks.mockResolvedValue([{ id: 'task-broken' }]);
    mocks.reclaimTaskRuntime.mockResolvedValue({
      confirmed: false,
      failures: [{ stage: 'detached-sessions', error: 'PTY still running' }],
    });

    await expect(archiveProject('project-1')).rejects.toThrow('PTY still running');

    expect(mocks.terminateProjectTerminals).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('fails closed when the one authoritative tmux inventory cannot be read', async () => {
    mocks.listTmuxSessionMarkersStrict.mockRejectedValue(new Error('SSH list failed'));

    await expect(archiveProject('project-1')).rejects.toThrow('SSH list failed');

    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.reclaimTaskRuntime).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('fails closed when the project runtime is unavailable', async () => {
    mocks.getProject.mockReturnValue(undefined);

    await expect(archiveProject('project-1')).rejects.toThrow('runtime is unavailable');

    expect(mocks.getTasks).not.toHaveBeenCalled();
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
