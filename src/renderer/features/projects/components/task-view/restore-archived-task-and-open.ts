import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

/**
 * Reactivates an archived task before entering its task view.
 *
 * Archived tasks cannot be provisioned directly. Restore first, then provision
 * the workspace and select the preferred conversation so opening an archived
 * row lands in the same place as opening an active task.
 */
export async function restoreArchivedTaskAndOpen(
  projectId: string,
  taskId: string,
  navigate: NavigateFnTyped
): Promise<void> {
  const taskManager = getTaskManagerStore(projectId);
  await taskManager?.restoreTask(taskId);
  await taskManager?.provisionTask(taskId);
  asProvisioned(getTaskStore(projectId, taskId))?.taskView.tabManager.openPreferredConversation();
  navigate('task', { projectId, taskId });
}
