import { when } from 'mobx';
import type { DeepLinkTarget } from '@shared/deep-links';
import type { TaskWindowTabTarget, TaskWindowTarget } from '@shared/task-window';
import type { ActiveFile } from '@shared/view-state';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  OVERVIEW_TAB_ID,
  type TabManagerStore,
} from '@renderer/features/tasks/tabs/tab-manager-store';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import type { AppTabEntry } from '@renderer/lib/stores/app-tabs-store';
import { log } from '@renderer/utils/logger';

/**
 * Opens (or focuses — routes are deduplicated) a top-level app tab for an
 * internal task tab target. The task view's TopLevelTabSync replays the target
 * onto the internal TabManagerStore once the route applies. With
 * `activate: false` the tab is only ensured in the strip, in the background.
 */
export function openTaskTopTab(
  projectId: string,
  taskId: string,
  tab: TaskWindowTabTarget,
  options?: { activate?: boolean }
): void {
  appState.appTabs.openTab('task', { projectId, taskId, tab }, options);
}

/**
 * Closes a top-level tab; for task tabs, the matching internal TabManagerStore
 * entry closes first. Without the internal close the entity would stay the
 * task's active internal tab, and the scope-entry restore in TopLevelTabSync
 * would resurrect the top-level tab in the same frame (the × appearing dead).
 * Non-task tabs fall through to a plain top-level close.
 */
export function closeTaskTopTab(tab: AppTabEntry): void {
  const { projectId, taskId } = tab.params as { projectId?: string; taskId?: string };
  const target = tab.params.tab as TaskWindowTabTarget | undefined;
  if (tab.viewId === 'task' && projectId && taskId && target && target.kind !== 'overview') {
    const tabManager = asProvisioned(getTaskStore(projectId, taskId))?.taskView.tabManager;
    const internalId = tabManager ? findInternalTabId(tabManager, target) : undefined;
    if (tabManager && internalId) tabManager.closeTab(internalId);
  }
  appState.appTabs.closeTab(tab.id);
}

/** Resolves a top-level tab target to the matching internal tab id, if open. */
export function findInternalTabId(
  tabManager: TabManagerStore,
  target: TaskWindowTabTarget
): string | undefined {
  for (const resolved of tabManager.resolvedTabs) {
    if (
      target.kind === 'conversation' &&
      resolved.kind === 'conversation' &&
      resolved.conversationId === target.conversationId
    ) {
      return resolved.tabId;
    }
    if (target.kind === 'file' && resolved.kind === 'file' && resolved.path === target.path) {
      return resolved.tabId;
    }
    if (
      target.kind === 'diff' &&
      resolved.kind === 'diff' &&
      resolved.path === target.path &&
      resolved.diffGroup === target.diffGroup
    ) {
      return resolved.tabId;
    }
  }
  return undefined;
}

export type OpenTaskTarget = Pick<
  DeepLinkTarget,
  'projectId' | 'taskId' | 'conversationId' | 'promptId' | 'promptIndex'
>;

export function openTaskTarget(
  target: OpenTaskTarget,
  navigate: NavigateFnTyped,
  disposers?: Set<() => void>,
  tabTarget?: TaskWindowTabTarget
): void {
  const { projectId, taskId, conversationId, promptId, promptIndex } = target;
  if (!taskId) {
    navigate('project', { projectId });
    return;
  }
  navigate('task', { projectId, taskId });
  const targetTab: TaskWindowTabTarget | null =
    tabTarget ?? (conversationId ? { kind: 'conversation', conversationId } : null);
  if (!targetTab) return;

  const dispose = when(
    () => Boolean(asProvisioned(getTaskStore(projectId, taskId))),
    () => {
      disposers?.delete(dispose);
      const provisioned = asProvisioned(getTaskStore(projectId, taskId));
      if (!provisioned) return;

      void openProvisionedTaskTab(provisioned, targetTab)
        .then((found) => {
          if (!found) return;

          if (targetTab.kind === 'conversation' && (promptId || promptIndex)) {
            // Prompts now live in the dedicated Conversation chapter; open it.
            provisioned.taskView.setSidebarCollapsed(false);
            provisioned.taskView.setSidebarTab('conversations');
          }
        })
        .catch((error: unknown) => {
          log.warn('openTaskTarget: failed to open tab target', {
            projectId,
            taskId,
            tabTarget: targetTab,
            error,
          });
        });
    },
    { timeout: 10_000 }
  );
  disposers?.add(dispose);
}

export function openTaskWindowTarget(
  target: TaskWindowTarget,
  navigate: NavigateFnTyped,
  disposers?: Set<() => void>
): void {
  openTaskTarget(
    {
      projectId: target.projectId,
      taskId: target.taskId,
      conversationId: target.tab.kind === 'conversation' ? target.tab.conversationId : undefined,
    },
    navigate,
    disposers,
    target.tab
  );
}

export async function openProvisionedTaskTab(
  provisioned: ProvisionedTask,
  tabTarget: TaskWindowTabTarget
): Promise<boolean> {
  switch (tabTarget.kind) {
    case 'overview':
      provisioned.taskView.tabManager.setActiveTab(OVERVIEW_TAB_ID);
      provisioned.taskView.setFocusedRegion('main');
      return true;
    case 'conversation': {
      const found = await provisioned.conversations.ensureConversation(tabTarget.conversationId);
      if (!found) return false;
      provisioned.taskView.tabManager.openConversation(tabTarget.conversationId);
      provisioned.taskView.setFocusedRegion('main');
      return true;
    }
    case 'file':
      provisioned.taskView.tabManager.openFile(tabTarget.path);
      provisioned.taskView.setFocusedRegion('main');
      return true;
    case 'diff':
      provisioned.taskView.tabManager.openDiff(diffTargetToActiveFile(tabTarget), tabTarget.status);
      provisioned.taskView.setFocusedRegion('main');
      return true;
  }
}

function diffTargetToActiveFile(
  tabTarget: Extract<TaskWindowTabTarget, { kind: 'diff' }>
): ActiveFile {
  return {
    path: tabTarget.path,
    type: tabTarget.diffGroup === 'disk' ? 'disk' : 'git',
    group: tabTarget.diffGroup,
    originalRef: tabTarget.originalRef,
    modifiedRef: tabTarget.modifiedRef,
    prNumber: tabTarget.prNumber,
  };
}
