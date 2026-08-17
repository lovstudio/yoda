import { useEffect, useLayoutEffect } from 'react';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import {
  getTaskManagerStore,
  type TaskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';

/**
 * Bring a hosted (non-routed) task up to `ready` the way the task route does:
 * hydrate it if the project's task map has not reached it yet, then provision it.
 *
 * Split-view panes, comparison panes and the agent board all host tasks outside
 * the route, and a task must behave identically on every one of those surfaces —
 * so they share this lifecycle instead of each re-deriving it.
 */
export function useHostedTaskLifecycle(
  projectId: string,
  taskId: string,
  kind: TaskViewKind,
  taskStore: TaskStore | undefined
): void {
  useLayoutEffect(() => {
    if (kind !== 'missing') return;
    void getTaskManagerStore(projectId)
      ?.ensureTaskLoaded(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId]);

  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;
    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);
}
