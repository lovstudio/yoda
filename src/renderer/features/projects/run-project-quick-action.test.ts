import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { runProjectQuickAction } from './run-project-quick-action';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runProjectCommand: vi.fn(),
  getTaskStore: vi.fn(),
  asProvisioned: vi.fn(),
  getTerminalsPaneSize: vi.fn(),
  createTask: vi.fn(),
  provisionTask: vi.fn(),
  navigation: {
    currentViewId: 'home',
    viewParamsStore: {} as Record<string, unknown>,
  },
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskStore: mocks.getTaskStore,
  asProvisioned: mocks.asProvisioned,
}));

vi.mock('@renderer/features/tasks/terminals/terminal-tabs', () => ({
  getTerminalsPaneSize: mocks.getTerminalsPaneSize,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: { navigation: mocks.navigation },
}));

vi.mock('./run-project-command', () => ({
  runProjectCommand: mocks.runProjectCommand,
}));

const localProject = {
  data: { id: 'project-1', type: 'local', path: '/repo' },
  taskManager: {
    tasks: new Map(),
    createTask: mocks.createTask,
    provisionTask: mocks.provisionTask,
  },
} as unknown as MountedProject;

const shellAction: QuickAction = {
  id: 'start',
  label: 'Start locally',
  command: 'pnpm run dev',
  kind: 'shell',
  sourceIntent: 'Start this project.',
};

function createProvisionedTask(taskId: string): ProvisionedTask {
  return {
    taskId,
    taskView: {
      setBottomPanelTab: vi.fn(),
      setBottomPanelOpen: vi.fn(),
      setFocusedRegion: vi.fn(),
      terminalTabs: { setActiveTab: vi.fn() },
    },
    terminals: {
      createCommandTerminal: vi.fn().mockResolvedValue({ id: 'terminal-1' }),
    },
  } as unknown as ProvisionedTask;
}

describe('runProjectQuickAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigation.currentViewId = 'home';
    mocks.navigation.viewParamsStore = {};
    mocks.asProvisioned.mockReturnValue(undefined);
    mocks.getTerminalsPaneSize.mockReturnValue({ cols: 120, rows: 36 });
  });

  it('runs a shell action as a standard persisted terminal in the active task', async () => {
    const task = createProvisionedTask('task-1');
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore = {
      task: { projectId: 'project-1', taskId: 'task-1' },
    };
    mocks.getTaskStore.mockReturnValue({ state: 'provisioned' });
    mocks.asProvisioned.mockReturnValue(task);

    await expect(
      runProjectQuickAction({ project: localProject, action: shellAction })
    ).resolves.toEqual({
      kind: 'shell',
      taskId: 'task-1',
    });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(task.taskView.setBottomPanelTab).toHaveBeenCalledWith('terminals', {
      ensureTerminal: false,
    });
    expect(task.taskView.setBottomPanelOpen).toHaveBeenCalledWith(true);
    expect(task.taskView.setFocusedRegion).toHaveBeenCalledWith('bottom');
    expect(task.terminals.createCommandTerminal).toHaveBeenCalledWith({
      command: 'pnpm run dev',
      label: 'Start locally',
      initialSize: { cols: 120, rows: 36 },
    });
    expect(task.taskView.terminalTabs.setActiveTab).toHaveBeenCalledWith('terminal-1');
  });

  it('finishes provisioning the active task before creating its terminal', async () => {
    const task = createProvisionedTask('task-1');
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore = {
      task: { projectId: 'project-1', taskId: 'task-1' },
    };
    mocks.getTaskStore.mockReturnValue({ state: 'unprovisioned' });
    mocks.asProvisioned.mockReturnValueOnce(undefined).mockReturnValue(task);

    await expect(
      runProjectQuickAction({ project: localProject, action: shellAction })
    ).resolves.toEqual({
      kind: 'shell',
      taskId: 'task-1',
    });

    expect(mocks.provisionTask).toHaveBeenCalledWith('task-1');
    expect(task.terminals.createCommandTerminal).toHaveBeenCalledOnce();
  });

  it('creates a no-worktree operation task when no task terminal is active', async () => {
    let createdTaskId = '';
    const task = createProvisionedTask('');
    mocks.createTask.mockImplementation(async (params: { id: string }) => {
      createdTaskId = params.id;
      Object.assign(task, { taskId: params.id });
    });
    mocks.getTaskStore.mockReturnValue({ state: 'provisioned' });
    mocks.asProvisioned.mockImplementation(() => task);
    const defaultBranch = { type: 'local', branch: 'main' } as const;

    const result = await runProjectQuickAction({
      project: localProject,
      action: shellAction,
      defaultBranch,
    });

    expect(result).toEqual({ kind: 'shell', taskId: createdTaskId });
    expect(mocks.createTask).toHaveBeenCalledWith({
      id: createdTaskId,
      projectId: 'project-1',
      name: expect.stringMatching(/^ops-start-locally-\d{8}-\d{4}$/),
      sourceBranch: defaultBranch,
      strategy: { kind: 'no-worktree' },
    });
    expect(task.terminals.createCommandTerminal).toHaveBeenCalledOnce();
  });

  it('does not fall back to the independent workspace shell without a terminal task', async () => {
    await expect(
      runProjectQuickAction({ project: localProject, action: shellAction })
    ).rejects.toThrow('default branch is required');

    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('routes Agent actions through the inspectable task execution path', async () => {
    const action: QuickAction = {
      id: 'release',
      label: 'Release',
      command: '/release-via-cicd',
      kind: 'agent',
    };
    const defaultBranch = { type: 'local', branch: 'main' } as const;
    mocks.runProjectCommand.mockResolvedValue('task-1');

    await expect(
      runProjectQuickAction({
        project: localProject,
        action,
        runtimeId: 'codex',
        defaultBranch,
      })
    ).resolves.toEqual({ kind: 'agent', taskId: 'task-1' });
    expect(mocks.runProjectCommand).toHaveBeenCalledWith({
      project: localProject,
      action,
      runtimeId: 'codex',
      defaultBranch,
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});
