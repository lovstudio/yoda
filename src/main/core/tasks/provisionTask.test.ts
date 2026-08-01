import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionTask } from './provisionTask';

const mocks = vi.hoisted(() => ({
  getProjectMock: vi.fn(),
  getTerminalsForTaskMock: vi.fn(),
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

vi.mock('@main/core/terminals/getTerminalsForTask', () => ({
  getTerminalsForTask: mocks.getTerminalsForTaskMock,
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
  archiveRequestedAt: null,
  archiveNote: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  lastInteractedAt: '2026-05-02T00:00:00.000Z',
  statusChangedAt: '2026-05-01T00:00:00.000Z',
  isPinned: 0,
  needsReview: 0,
  isUserNamed: 0,
  setupStatus: 'ready',
  setupError: null,
  setupData: null,
  workspaceProvider: null,
  workspaceId: null,
  workspaceProviderData: null,
};

const conversationRow = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  runtime: 'codex',
  title: 'Codex',
  config: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  archivedAt: null,
  lastInteractedAt: '2026-05-02T00:00:00.000Z',
  isInitialConversation: true,
  forkedFromConversationId: null,
  forkedFromPromptIndex: null,
};

describe('provisionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.selectMock.mockReturnValue({ from: mocks.fromMock });
    mocks.fromMock.mockReturnValue({ where: mocks.whereMock });
    mocks.whereMock
      .mockReset()
      .mockResolvedValueOnce([taskRow])
      .mockResolvedValueOnce([conversationRow]);
    mocks.getTerminalsForTaskMock.mockResolvedValue([]);

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
      conversations: [
        expect.objectContaining({
          id: 'conversation-1',
          resume: false,
          pendingInitialPrompt: undefined,
        }),
      ],
    });
    expect(mocks.provisionTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task-1' }),
      [
        expect.objectContaining({
          id: 'conversation-1',
          resume: true,
        }),
      ],
      []
    );
    expect(mocks.whereMock).toHaveBeenCalledTimes(2);
    expect(mocks.setMock).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      workspaceProviderData: null,
    });
  });

  it('returns conversations from the same database source when main already owns the task', async () => {
    mocks.getTaskMock.mockReturnValue({ taskId: 'task-1' });
    mocks.getWorkspaceIdMock.mockReturnValue('workspace-1');

    const result = await provisionTask('task-1');

    expect(result.conversations).toEqual([
      expect.objectContaining({ id: 'conversation-1', resume: false }),
    ]);
    expect(mocks.whereMock).toHaveBeenCalledTimes(2);
    expect(mocks.getTerminalsForTaskMock).not.toHaveBeenCalled();
    expect(mocks.provisionTaskMock).not.toHaveBeenCalled();
  });

  it('refuses to reprovision an archived task before loading runtime state', async () => {
    mocks.whereMock
      .mockReset()
      .mockResolvedValueOnce([{ ...taskRow, archivedAt: '2026-08-01T00:00:00.000Z' }]);

    await expect(provisionTask('task-1')).rejects.toThrow('Cannot provision archived task');

    expect(mocks.getProjectMock).not.toHaveBeenCalled();
    expect(mocks.getTerminalsForTaskMock).not.toHaveBeenCalled();
    expect(mocks.provisionTaskMock).not.toHaveBeenCalled();
  });

  it('refuses to reprovision a task as soon as archive intent is persisted', async () => {
    mocks.whereMock
      .mockReset()
      .mockResolvedValueOnce([{ ...taskRow, archiveRequestedAt: '2026-08-01T00:00:00.000Z' }]);

    await expect(provisionTask('task-1')).rejects.toThrow('Cannot provision archived task');

    expect(mocks.getProjectMock).not.toHaveBeenCalled();
    expect(mocks.getTerminalsForTaskMock).not.toHaveBeenCalled();
    expect(mocks.provisionTaskMock).not.toHaveBeenCalled();
  });
});
