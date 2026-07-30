import type { ProjectLaunchCommand } from '@shared/quick-actions';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { getTerminalsPaneSize } from '@renderer/features/tasks/terminals/terminal-tabs';

/**
 * Runs a discovered project launch command as a standard task terminal.
 *
 * Returning false means the requested task is not currently provisioned, so
 * the caller can explain that a task must be open without creating a parallel
 * project-shell execution path.
 */
export async function runProjectLaunchCommand({
  projectId,
  taskId,
  launchCommand,
}: {
  projectId: string;
  taskId: string;
  launchCommand: ProjectLaunchCommand;
}): Promise<boolean> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return false;

  provisioned.taskView.setBottomPanelTab('terminals', { ensureTerminal: false });
  provisioned.taskView.setBottomPanelOpen(true);
  provisioned.taskView.setFocusedRegion('bottom');

  const terminal = await provisioned.terminals.createCommandTerminal({
    command: launchCommand.command,
    label: launchCommand.label,
    initialSize: getTerminalsPaneSize(),
  });
  provisioned.taskView.terminalTabs.setActiveTab(terminal.id);
  return true;
}
