import type { TaskWindowTabTarget } from '@shared/task-window';
import type { NavigationHistoryStore } from '@renderer/lib/stores/navigation-history-store';
import type { TabManagerStore } from './tabs/tab-manager-store';

export type TaskSessionTarget = Extract<TaskWindowTabTarget, { kind: 'conversation' }>;

type TaskSessionHistory = Pick<NavigationHistoryStore, 'lastTaskTab'>;
type TaskSessionTabs = Pick<
  TabManagerStore,
  'topLevelTargetForTabId' | 'activeTopLevelTarget' | 'preferredConversationTarget'
>;

function isTaskSessionTarget(
  target: TaskWindowTabTarget | null | undefined
): target is TaskSessionTarget {
  return target?.kind === 'conversation';
}

/**
 * Resolves the target used when a task row is opened. Navigation history also
 * contains Overview, file, diff, and room-member pages; those are not the
 * task's last session and must not win a normal task-row click.
 */
export function resolveLastTaskSessionTarget(
  history: TaskSessionHistory,
  tabs: TaskSessionTabs,
  projectId: string,
  taskId: string
): TaskSessionTarget | undefined {
  const historyTabId = history.lastTaskTab(projectId, taskId, (tabId) =>
    isTaskSessionTarget(tabs.topLevelTargetForTabId(tabId))
  );
  const historyTarget = historyTabId ? tabs.topLevelTargetForTabId(historyTabId) : undefined;
  if (isTaskSessionTarget(historyTarget)) return historyTarget;

  const activeTarget = tabs.activeTopLevelTarget;
  if (isTaskSessionTarget(activeTarget)) return activeTarget;

  return tabs.preferredConversationTarget ?? undefined;
}
