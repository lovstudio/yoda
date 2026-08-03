import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { runProjectQuickAction } from './run-project-quick-action';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  runProjectCommand: vi.fn(),
  createTask: vi.fn(),
}));

vi.mock('@renderer/lib/stores/workspace-terminal-store', () => ({
  workspaceTerminalStore: { runCommand: mocks.runCommand },
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
  kind: 'command',
  sourceIntent: 'Start this project.',
};

describe('runProjectQuickAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCommand.mockResolvedValue('terminal-1');
  });

  it('runs a shell action in the project terminal without creating or resolving a task', async () => {
    const defaultBranch = { type: 'local', branch: 'main' } as const;

    await expect(
      runProjectQuickAction({
        project: localProject,
        action: shellAction,
        defaultBranch,
      })
    ).resolves.toEqual({ kind: 'command', terminalId: 'terminal-1' });

    expect(mocks.runCommand).toHaveBeenCalledWith(
      localProject.data,
      'pnpm run dev',
      'Start locally',
      'start'
    );
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.runProjectCommand).not.toHaveBeenCalled();
  });

  it('runs remote shell actions through the project Terminal provider', async () => {
    const remoteProject = {
      data: { id: 'project-2', type: 'ssh', connectionId: 'ssh-1', path: '/repo' },
    } as unknown as MountedProject;

    await expect(
      runProjectQuickAction({ project: remoteProject, action: shellAction })
    ).resolves.toEqual({ kind: 'command', terminalId: 'terminal-1' });
    expect(mocks.runCommand).toHaveBeenCalledWith(
      remoteProject.data,
      'pnpm run dev',
      'Start locally',
      'start'
    );
  });

  it('keeps Skill actions on the inspectable task execution path', async () => {
    const action: QuickAction = {
      id: 'release',
      label: 'Release',
      command: '/release-via-cicd',
      kind: 'skill',
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
    ).resolves.toEqual({ kind: 'skill', taskId: 'task-1' });
    expect(mocks.runProjectCommand).toHaveBeenCalledWith({
      project: localProject,
      action,
      runtimeId: 'codex',
      defaultBranch,
      quickActionSource: undefined,
      onTaskCreated: undefined,
    });
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('forwards immediate task-entry and post-run distillation metadata', async () => {
    const action: QuickAction = {
      id: 'review',
      label: 'Review',
      command: 'Review the current changes.',
      kind: 'skill',
    };
    const defaultBranch = { type: 'local', branch: 'main' } as const;
    const onTaskCreated = vi.fn();
    mocks.runProjectCommand.mockResolvedValue('task-2');

    await runProjectQuickAction({
      project: localProject,
      action,
      runtimeId: 'codex',
      defaultBranch,
      quickActionSource: { prompt: action.command, invokedSkill: false },
      onTaskCreated,
    });

    expect(mocks.runProjectCommand).toHaveBeenCalledWith({
      project: localProject,
      action,
      runtimeId: 'codex',
      defaultBranch,
      quickActionSource: { prompt: action.command, invokedSkill: false },
      onTaskCreated,
    });
  });
});
