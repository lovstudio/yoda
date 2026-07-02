import { isRegistered } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';

export type LinkedIssueInfo = { taskId: string; taskName: string };

/**
 * Reads from observable task state — call only inside `observer` components.
 * Returns a map from issue URL → linked task info entries for non-archived tasks,
 * optionally excluding a single task (e.g. when re-selecting the same task's issue).
 */
export function getLinkedIssueMap(
  projectId: string | undefined,
  excludeTaskId?: string
): Map<string, LinkedIssueInfo[]> {
  const map = new Map<string, LinkedIssueInfo[]>();
  if (!projectId) return map;
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return map;
  for (const store of taskManager.tasks.values()) {
    if (!isRegistered(store)) continue;
    if (excludeTaskId && store.data.id === excludeTaskId) continue;
    if (store.data.archivedAt) continue;
    const linkedIssues =
      store.data.linkedIssues ?? (store.data.linkedIssue ? [store.data.linkedIssue] : []);
    for (const issue of linkedIssues) {
      const url = issue.url;
      if (!url) continue;
      const linkedTasks = map.get(url) ?? [];
      linkedTasks.push({ taskId: store.data.id, taskName: store.data.name });
      map.set(url, linkedTasks);
    }
  }
  return map;
}
