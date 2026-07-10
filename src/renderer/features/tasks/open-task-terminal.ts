import { asProvisioned, getTaskStore } from './stores/task-selectors';

export function openTaskTerminal(projectId: string, taskId: string): boolean {
  const task = asProvisioned(getTaskStore(projectId, taskId));
  if (!task) return false;
  task.taskView.setBottomPanelTab('terminals');
  task.taskView.setTerminalDrawerOpen(true);
  task.taskView.setFocusedRegion('bottom');
  return true;
}
