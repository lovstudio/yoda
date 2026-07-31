import type { Branch } from '@shared/git';
import type { ProjectLaunchCommand } from '@shared/quick-actions';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { runProjectQuickAction } from './run-project-quick-action';

/**
 * Runs a discovered launch command through the same persisted task Terminal
 * lifecycle as saved shell quick actions.
 */
export async function runProjectLaunchCommand({
  project,
  launchCommand,
  defaultBranch,
}: {
  project: MountedProject;
  launchCommand: ProjectLaunchCommand;
  defaultBranch: Branch | undefined;
}): Promise<string> {
  const result = await runProjectQuickAction({
    project,
    action: {
      id: launchCommand.id,
      label: launchCommand.label,
      command: launchCommand.command,
      kind: 'shell',
    },
    defaultBranch,
  });
  return result.taskId;
}
