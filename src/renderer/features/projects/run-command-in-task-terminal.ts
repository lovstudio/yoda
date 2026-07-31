import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { getTerminalsPaneSize } from '@renderer/features/tasks/terminals/terminal-tabs';

export async function runCommandInTaskTerminal({
  task,
  command,
  label,
}: {
  task: ProvisionedTask;
  command: string;
  label: string;
}): Promise<void> {
  task.taskView.setBottomPanelTab('terminals', { ensureTerminal: false });
  task.taskView.setBottomPanelOpen(true);
  task.taskView.setFocusedRegion('bottom');

  const terminal = await task.terminals.createCommandTerminal({
    command,
    label,
    initialSize: getTerminalsPaneSize(),
  });
  task.taskView.terminalTabs.setActiveTab(terminal.id);
}
