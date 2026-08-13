import type { TaskWindowTabTarget } from '@shared/task-window';
import { openProvisionedTaskTab } from '@renderer/app/open-task-target';
import { prepareExplicitTaskOpen } from '@renderer/app/prepare-explicit-task-open';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';
import { resolveLastTaskSessionTarget } from './resolve-task-session-target';
import { taskOpenTransitionStore } from './task-open-transition-store';

let latestOpenRequest = 0;

function currentNavigationKey(): string {
  const viewId = appState.navigation.currentViewId;
  return `${viewId}:${JSON.stringify(appState.navigation.viewParamsStore[viewId] ?? {})}`;
}

/**
 * Opens a task without putting a shell-level placeholder between the click and
 * the destination.
 *
 * A provisioned task takes the synchronous path: selecting a conversation tab
 * mutates the tab store before its first await, so the route can switch in the
 * same click turn. The mounted ConversationSession then reuses its FrontendPty
 * and asks the backend to resume only when the stable session is not live.
 *
 * A cold task routes immediately to the task's single stable opening surface.
 * Mount/provision/hydration continue in the background and the final target is
 * committed before React gets a chance to paint a ready overview in between.
 */
export async function openTaskWhenReady(
  projectId: string,
  taskId: string,
  navigate: NavigateFnTyped,
  explicitTarget?: TaskWindowTabTarget
): Promise<boolean> {
  const request = ++latestOpenRequest;
  let target: TaskWindowTabTarget | undefined = explicitTarget;
  let provisioned = asProvisioned(getTaskStore(projectId, taskId));

  // The normal task-row path is already provisioned. Resolve and select the
  // remembered session synchronously, then switch route without waiting for
  // mount/provision/resume RPC round trips.
  if (provisioned) {
    target ??= resolveLastTaskSessionTarget(
      appState.history,
      provisioned.taskView.tabManager,
      projectId,
      taskId
    ) ?? { kind: 'overview' };
    const foundPromise = openProvisionedTaskTab(provisioned, target, {
      shouldApply: () => request === latestOpenRequest,
    });
    appState.appTabs.openTaskScope(projectId, taskId, target);
    const destinationNavigationKey = currentNavigationKey();
    const isCurrentDestination = () =>
      request === latestOpenRequest && currentNavigationKey() === destinationNavigationKey;

    try {
      const found = await foundPromise;
      if (!isCurrentDestination()) return false;
      if (found) return true;

      target = { kind: 'overview' };
      await openProvisionedTaskTab(provisioned, target, { shouldApply: isCurrentDestination });
      if (!isCurrentDestination()) return false;
      appState.appTabs.openTaskScope(projectId, taskId, target);
      return true;
    } catch (error) {
      if (!isCurrentDestination()) return false;
      log.warn('Failed to open provisioned task target', { projectId, taskId, target, error });
      return false;
    }
  }

  // Publish one target-task surface immediately. This is also the cancellation
  // boundary: a later task click changes the navigation key and owns the route.
  const transitionLease = taskOpenTransitionStore.begin(projectId, taskId);
  navigate('task', {
    projectId,
    taskId,
    ...(target ? { tab: target } : {}),
  });
  let destinationNavigationKey = currentNavigationKey();
  const isCurrentRequest = () =>
    request === latestOpenRequest && currentNavigationKey() === destinationNavigationKey;

  try {
    await prepareExplicitTaskOpen(projectId, taskId);
    if (!isCurrentRequest()) return false;

    const taskManager = getTaskManagerStore(projectId);
    if (!taskManager) throw new Error(`Project ${projectId} could not be mounted`);
    await taskManager.provisionTask(taskId);
    if (!isCurrentRequest()) return false;

    provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (!provisioned) throw new Error(`Task ${taskId} could not be provisioned`);

    target ??= resolveLastTaskSessionTarget(
      appState.history,
      provisioned.taskView.tabManager,
      projectId,
      taskId
    ) ?? { kind: 'overview' };

    const foundPromise = openProvisionedTaskTab(provisioned, target, {
      shouldApply: isCurrentRequest,
    });
    // Commit the resolved target in the same continuation that observes the
    // provisioned task. Target validation may still yield even on a cache hit;
    // routing first prevents React from committing a ready Overview in between.
    appState.appTabs.openTaskScope(projectId, taskId, target);
    destinationNavigationKey = currentNavigationKey();
    const found = await foundPromise;
    if (!isCurrentRequest()) return false;
    if (!found) {
      target = { kind: 'overview' };
      await openProvisionedTaskTab(provisioned, target, { shouldApply: isCurrentRequest });
      if (!isCurrentRequest()) return false;
      // The provisional conversation target is already in the top-level route.
      // Replace it as well as the internal tab, otherwise the conversation
      // panel keeps resolving a target that the authoritative snapshot proved
      // does not exist.
      appState.appTabs.openTaskScope(projectId, taskId, target);
    }

    return true;
  } catch (error) {
    if (!isCurrentRequest()) return false;
    log.warn('Failed to prepare task before opening', { projectId, taskId, error });
    return false;
  } finally {
    taskOpenTransitionStore.complete(projectId, taskId, transitionLease);
  }
}
