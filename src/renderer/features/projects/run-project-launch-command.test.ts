import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectLaunchCommand } from '@shared/quick-actions';
import { runProjectLaunchCommand } from './run-project-launch-command';
import type { MountedProject } from './stores/project';

const mocks = vi.hoisted(() => ({
  runProjectQuickAction: vi.fn(),
}));

vi.mock('./run-project-quick-action', () => ({
  runProjectQuickAction: mocks.runProjectQuickAction,
}));

const launchCommand: ProjectLaunchCommand = {
  id: 'package-script:dev',
  label: 'Start locally',
  command: 'pnpm run dev',
  source: 'package.json',
};

const project = {
  data: { id: 'project-1', type: 'local', path: '/repo' },
} as MountedProject;

describe('runProjectLaunchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runProjectQuickAction.mockResolvedValue({ kind: 'shell' });
  });

  it('routes a detected launch command through the task-free project terminal lifecycle', async () => {
    await expect(
      runProjectLaunchCommand({
        project,
        launchCommand,
      })
    ).resolves.toBeUndefined();

    expect(mocks.runProjectQuickAction).toHaveBeenCalledWith({
      project,
      action: {
        id: 'package-script:dev',
        label: 'Start locally',
        command: 'pnpm run dev',
        kind: 'shell',
      },
    });
  });
});
