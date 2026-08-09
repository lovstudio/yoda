import type { TaskUsage } from '@shared/stats';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { prepareExplicitTaskOpen } from '@renderer/app/prepare-explicit-task-open';
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
  await prepareExplicitTaskOpen(task.projectId, task.taskId);
  openTaskTarget({ projectId: task.projectId, taskId: task.taskId }, navigate);
}
