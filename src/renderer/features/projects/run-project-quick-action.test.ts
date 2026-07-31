import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { runProjectQuickAction } from './run-project-quick-action';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  runProjectCommand: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('@renderer/lib/stores/workspace-shell-store', () => ({
  workspaceShellStore: { runCommand: mocks.runCommand },
}));

vi.mock('./run-project-command', () => ({
  runProjectCommand: mocks.runProjectCommand,
}));

const localProject = {
  data: { id: 'project-1', type: 'local', path: '/repo' },
  taskManager: { tasks: new Map(), createTask: mocks.createTask },
} as unknown as MountedProject;

const shellAction: QuickAction = {
  id: 'start',
  label: 'Start locally',
  command: 'pnpm run dev',
  kind: 'shell',
  sourceIntent: 'Start this project.',
};

describe('runProjectQuickAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCommand.mockResolvedValue(undefined);
  });

  it('runs a shell action in the project terminal without creating or resolving a task', async () => {
    const defaultBranch = { type: 'local', branch: 'main' } as const;

    await expect(
      runProjectQuickAction({
        project: localProject,
        action: shellAction,
        defaultBranch,
      })
    ).resolves.toEqual({ kind: 'shell' });

    expect(mocks.runCommand).toHaveBeenCalledWith('pnpm run dev', '/repo');
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.runProjectCommand).not.toHaveBeenCalled();
  });

  it('rejects shell actions for remote projects before opening a local terminal', async () => {
    const remoteProject = {
      data: { id: 'project-2', type: 'ssh', connectionId: 'ssh-1', path: '/repo' },
    } as unknown as MountedProject;

    await expect(
      runProjectQuickAction({ project: remoteProject, action: shellAction })
    ).rejects.toThrow('require a local project');
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('keeps Agent actions on the inspectable task execution path', async () => {
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
