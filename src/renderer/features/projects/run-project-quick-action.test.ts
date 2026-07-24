import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { runProjectQuickAction } from './run-project-quick-action';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runCommand: vi.fn(),
  runProjectCommand: vi.fn(),
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
    expect(mocks.runCommand).toHaveBeenCalledWith('pnpm run dev', '/repo', 'Start locally');
    expect(mocks.runProjectCommand).not.toHaveBeenCalled();
  });

  it('keeps legacy Agent actions on the task execution path', async () => {
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
