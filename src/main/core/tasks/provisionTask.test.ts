import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionTask } from './provisionTask';

const mocks = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  getTaskMock: vi.fn(),
  getWorkspaceIdMock: vi.fn(),
  provisionTaskMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  whereMock: vi.fn(),
  updateMock: vi.fn(),
  setMock: vi.fn(),
  updateWhereMock: vi.fn(),
  workspaceGetMock: vi.fn(),
  telemetryCaptureMock: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProjectMock,
  },
}));

vi.mock('@main/core/tasks/task-manager', () => ({
  taskManager: {
    getTask: mocks.getTaskMock,
    getWorkspaceId: mocks.getWorkspaceIdMock,
    provisionTask: mocks.provisionTaskMock,
  },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    get: mocks.workspaceGetMock,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: mocks.selectMock,
    update: mocks.updateMock,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.telemetryCaptureMock,
  },
}));

const taskRow = {
  id: 'task-1',
  projectId: 'project-1',
  name: 'Task',
  status: 'in_progress',
  sourceBranch: null,
  taskBranch: null,
  linkedIssue: null,
  archivedAt: null,
  archiveNote: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  lastInteractedAt: '2026-05-02T00:00:00.000Z',
  statusChangedAt: '2026-05-01T00:00:00.000Z',
  isPinned: 0,
  needsReview: 0,
  isUserNamed: 0,
  workspaceProvider: null,
  workspaceId: null,
  workspaceProviderData: null,
};

describe('provisionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.selectMock.mockReturnValue({ from: mocks.fromMock });
    mocks.fromMock.mockReturnValue({ where: mocks.whereMock });
    mocks.whereMock
      .mockResolvedValueOnce([taskRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    mocks.updateMock.mockReturnValue({ set: mocks.setMock });
    mocks.setMock.mockReturnValue({ where: mocks.updateWhereMock });
    mocks.updateWhereMock.mockResolvedValue(undefined);

    mocks.getProjectMock.mockReturnValue({
      type: 'local',
      id: 'project-1',
      name: 'Project',
      alias: null,
      path: '/repo',
      baseRef: 'main',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    mocks.getTaskMock.mockReturnValue(undefined);
    mocks.provisionTaskMock.mockResolvedValue({
      success: true,
      data: {
        persistData: {
          workspaceId: 'workspace-1',
          workspaceProviderData: null,
          sshConnectionId: undefined,
        },
      },
    });
    mocks.workspaceGetMock.mockReturnValue({ path: '/repo/worktrees/task-1' });
  });

  it('does not update lastInteractedAt when opening/provisioning a task', async () => {
    const result = await provisionTask('task-1');

    expect(result).toEqual({
      path: '/repo/worktrees/task-1',
      workspaceId: 'workspace-1',
      sshConnectionId: undefined,
    });
    expect(mocks.setMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workspaceProviderData: null,
    });
  });
});
