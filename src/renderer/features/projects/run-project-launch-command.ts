import type { ProjectLaunchCommand } from '@shared/quick-actions';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { runProjectQuickAction } from './run-project-quick-action';

/**
 * Runs a discovered launch command through the same project-level Terminal
 * lifecycle as saved shell quick actions, without creating a task.
 */
export async function runProjectLaunchCommand({
  project,
  launchCommand,
}: {
  project: MountedProject;
  launchCommand: ProjectLaunchCommand;
}): Promise<void> {
  await runProjectQuickAction({
    project,
    action: {
      id: launchCommand.id,
      label: launchCommand.label,
      command: launchCommand.command,
      kind: 'shell',
    },
  });
}
