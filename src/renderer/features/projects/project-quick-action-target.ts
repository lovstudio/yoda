import type { QuickAction } from '@shared/project-settings';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { taskSessionStatusSummary } from '@renderer/features/tasks/stores/task-selectors';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';

export type ProjectQuickActionTarget =
  | { kind: 'terminal'; actionId: string }
  | { kind: 'task'; taskId: string };

export function getRunningProjectQuickActionTarget(
  project: MountedProject,
  action: QuickAction
): ProjectQuickActionTarget | null {
  if (action.kind === 'command') {
    return workspaceTerminalStore.isQuickActionRunning(project.data, action.id)
      ? { kind: 'terminal', actionId: action.id }
      : null;
  }

  let latestTaskId: string | null = null;
  let latestCreatedAt = '';
  for (const task of project.taskManager.tasks.values()) {
    if (task.data.quickActionId !== action.id) continue;
    if (isRegistered(task) && task.data.archivedAt) continue;
    const sessionStatus = task.isBootstrapping
      ? null
      : taskSessionStatusSummary(task).primaryStatus;
    const isRunning =
      task.isBootstrapping || sessionStatus === 'working' || sessionStatus === 'awaiting-input';
    if (!isRunning || task.data.createdAt < latestCreatedAt) continue;
    latestTaskId = task.data.id;
    latestCreatedAt = task.data.createdAt;
  }
  return latestTaskId ? { kind: 'task', taskId: latestTaskId } : null;
}

export async function openProjectQuickActionTarget(
  project: MountedProject,
  target: ProjectQuickActionTarget,
  openTask: (taskId: string) => void
): Promise<boolean> {
  if (target.kind === 'task') {
    openTask(target.taskId);
    return true;
  }
  return workspaceTerminalStore.openQuickActionTerminal(project.data, target.actionId);
}
