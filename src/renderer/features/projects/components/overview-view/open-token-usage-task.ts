import type { TaskUsage } from '@shared/stats';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

type TokenUsageTaskTarget = Pick<TaskUsage, 'projectId' | 'taskId' | 'archived'>;

/**
 * Opens a task surfaced by usage statistics. Archived tasks must be restored
 * before the task view can provision them.
 */
export async function openTokenUsageTask(
  task: TokenUsageTaskTarget,
  navigate: NavigateFnTyped
): Promise<void> {
  if (task.archived) {
    await getTaskManagerStore(task.projectId)?.restoreTask(task.taskId);
  }
  openTaskTarget({ projectId: task.projectId, taskId: task.taskId }, navigate);
}
