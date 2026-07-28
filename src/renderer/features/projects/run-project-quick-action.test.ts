import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { runProjectQuickAction } from './run-project-quick-action';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  runProjectCommand: vi.fn(),
  getTaskStore: vi.fn(),
  asProvisioned: vi.fn(),
  navigation: {
    currentViewId: 'home',
    viewParamsStore: {} as Record<string, unknown>,
  },
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskStore: mocks.getTaskStore,
  asProvisioned: mocks.asProvisioned,
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: { navigation: mocks.navigation },
}));

vi.mock('@renderer/lib/stores/workspace-shell-store', () => ({
  workspaceShellStore: { runCommand: mocks.runCommand },
}));

vi.mock('./run-project-command', () => ({
  runProjectCommand: mocks.runProjectCommand,
}));

const localProject = {
  data: { id: 'project-1', type: 'local', path: '/repo' },
} as MountedProject;

describe('runProjectQuickAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigation.currentViewId = 'home';
    mocks.navigation.viewParamsStore = {};
    mocks.asProvisioned.mockReturnValue(undefined);
    mocks.runCommand.mockResolvedValue(undefined);
  });

  it('executes compiled shell actions directly in the project terminal', async () => {
    const action: QuickAction = {
      id: 'start',
      label: 'Start locally',
      command: 'pnpm run dev',
      kind: 'shell',
      sourceIntent: 'Start this project.',
    };

    await expect(runProjectQuickAction({ project: localProject, action })).resolves.toEqual({
      kind: 'shell',
    });
    expect(mocks.runCommand).toHaveBeenCalledWith('pnpm run dev', '/repo', 'Start locally', null);
    expect(mocks.runProjectCommand).not.toHaveBeenCalled();
  });

  it('hosts a shell action in the active task bottom panel for the same project', async () => {
    const setBottomPanelTab = vi.fn();
    const setBottomPanelOpen = vi.fn();
    const setFocusedRegion = vi.fn();
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore = {
      task: { projectId: 'project-1', taskId: 'task-1' },
    };
    mocks.getTaskStore.mockReturnValue({ state: 'provisioned' });
    mocks.asProvisioned.mockReturnValue({
      taskId: 'task-1',
      taskView: { setBottomPanelTab, setBottomPanelOpen, setFocusedRegion },
    });
    const action: QuickAction = {
      id: 'start',
      label: 'Start locally',
      command: 'pnpm run dev',
      kind: 'shell',
    };

    await runProjectQuickAction({ project: localProject, action });

    expect(mocks.getTaskStore).toHaveBeenCalledWith('project-1', 'task-1');
    expect(setBottomPanelTab).toHaveBeenCalledWith('terminals', {
      ensureTerminal: false,
    });
    expect(setBottomPanelOpen).toHaveBeenCalledWith(true);
    expect(setFocusedRegion).toHaveBeenCalledWith('bottom');
    expect(mocks.runCommand).toHaveBeenCalledWith(
      'pnpm run dev',
      '/repo',
      'Start locally',
      'task-1'
    );
  });

  it('keeps a different project task out of the quick action host', async () => {
    mocks.navigation.currentViewId = 'task';
    mocks.navigation.viewParamsStore = {
      task: { projectId: 'project-2', taskId: 'task-2' },
    };
    const action: QuickAction = {
      id: 'start',
      label: 'Start locally',
      command: 'pnpm run dev',
      kind: 'shell',
    };

    await runProjectQuickAction({ project: localProject, action });

    expect(mocks.getTaskStore).not.toHaveBeenCalled();
    expect(mocks.runCommand).toHaveBeenCalledWith('pnpm run dev', '/repo', 'Start locally', null);
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
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });
});
