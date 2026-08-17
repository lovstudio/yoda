import type { TaskWindowTabTarget } from '@shared/task-window';
import {
  openProvisionedTaskTab,
  type DeferredTaskTabSelection,
} from '@renderer/app/open-task-target';
import { prepareExplicitTaskOpen } from '@renderer/app/prepare-explicit-task-open';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';
import { resolveLastTaskSessionTarget } from './resolve-task-session-target';
import {
  beginTaskOpenTrace,
  cancelTaskOpenTrace,
  getTaskOpenPerformanceContext,
  markTaskOpenTrace,
} from './task-open-performance';
import { taskOpenTransitionStore } from './task-open-transition-store';

let latestOpenRequest = 0;
/**
 * Keep the source visible only while the destination target/provisioning is
 * genuinely unresolved. A resolved cold/evicted destination bypasses this
 * timer and mounts its opaque staging route immediately.
 */
const TASK_OPEN_LOADING_THRESHOLD_MS = 900;
/** Safety ceiling for genuine provisioning/startup failures, not the product latency target. */
const TASK_OPEN_HARD_TIMEOUT_MS = 30_000;
/**
 * Deadline — measured from the click, not from the moment preparation starts —
 * for destination layout, generation binding, parse, and staging paint. The
 * user's clock starts at the click, so a slow provisioning phase must eat into
 * this window rather than stack another full budget on top of it.
 */
const TASK_OPEN_SESSION_STAGING_DEADLINE_MS = 1_500;
/**
 * Floor so a slow provisioning phase still leaves preparation a usable window
 * instead of a zero-length one that always defers.
 */
const TASK_OPEN_SESSION_STAGING_FLOOR_MS = 400;
const TASK_OPEN_CANCELLATION_POLL_MS = 25;

class TaskOpenCancelledError extends Error {}
class TaskOpenDeadlineError extends Error {}

type TaskTargetOpenOutcome =
  | { ok: true; selection: DeferredTaskTabSelection }
  | { ok: false; error: unknown };

function captureTaskTargetOpen(
  promise: Promise<DeferredTaskTabSelection>
): Promise<TaskTargetOpenOutcome> {
  return promise.then(
    (selection) => ({ ok: true, selection }),
    (error: unknown) => ({ ok: false, error })
  );
}

function unwrapTaskTargetOpen(outcome: TaskTargetOpenOutcome): DeferredTaskTabSelection {
  if (!outcome.ok) throw outcome.error;
  return outcome.selection;
}

function waitForTaskOpenStep<T>(
  promise: Promise<T>,
  shouldContinue: () => boolean,
  deadline: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let cancellationTimer: ReturnType<typeof setInterval> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (cancellationTimer !== null) clearInterval(cancellationTimer);
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    cancellationTimer = setInterval(() => {
      if (!shouldContinue()) {
        finish(() => reject(new TaskOpenCancelledError('Task open was superseded')));
      }
    }, TASK_OPEN_CANCELLATION_POLL_MS);
    deadlineTimer = setTimeout(
      () => finish(() => reject(new TaskOpenDeadlineError('Task open exceeded 30 seconds'))),
      Math.max(0, deadline - performance.now())
    );
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

type NavigationLease = {
  revision: number;
  routeKey: string;
};

type TaskOpenFailureStage =
  | 'stage-provisioned-target'
  | 'open-provisioned-target'
  | 'prepare-cold-task';

function currentNavigationKey(): string {
  const viewId = appState.navigation.currentViewId;
  return `${viewId}:${JSON.stringify(appState.navigation.viewParamsStore[viewId] ?? {})}`;
}

function currentNavigationLease(): NavigationLease {
  return {
    revision: appState.navigation.revision,
    routeKey: currentNavigationKey(),
  };
}

function isNavigationLeaseCurrent(lease: NavigationLease): boolean {
  return (
    appState.navigation.revision === lease.revision && currentNavigationKey() === lease.routeKey
  );
}

function notifyTaskOpenFailure(
  projectId: string,
  taskId: string,
  target: TaskWindowTabTarget | undefined,
  stage: TaskOpenFailureStage,
  error: unknown
): void {
  toast({
    title: i18n.t('tasks.conversations.startingErrorTitle'),
    description: i18n.t('tasks.conversations.startingErrorDescription'),
    variant: 'destructive',
    debugInfo: {
      stage,
      projectId,
      taskId,
      target: target ?? null,
      error,
    },
  });
}

/**
 * Opens a task without putting a shell-level placeholder between the click and
 * the destination.
 *
 * A provisioned task with a canonical cached terminal takes the synchronous
 * path. If its renderer was evicted, the session is staged off-screen first.
 *
 * A cold task keeps the current route visible while mount, provision, resume,
 * and canonical-frame parsing complete. The destination route is committed
 * once, so workspace and PTY internals never become user-visible pages.
 */
export async function openTaskWhenReady(
  projectId: string,
  taskId: string,
  _navigate: NavigateFnTyped,
  explicitTarget?: TaskWindowTabTarget
): Promise<boolean> {
  const traceContextId = beginTaskOpenTrace(projectId, taskId);
  try {
    const opened = await openTaskWhenReadyAfterTrace(projectId, taskId, _navigate, explicitTarget);
    if (!opened) {
      cancelTaskOpenTrace(projectId, taskId, { reason: 'task-open-not-committed' }, traceContextId);
    }
    return opened;
  } catch (error) {
    cancelTaskOpenTrace(projectId, taskId, { reason: 'task-open-rejected' }, traceContextId);
    throw error;
  }
}

async function openTaskWhenReadyAfterTrace(
  projectId: string,
  taskId: string,
  _navigate: NavigateFnTyped,
  explicitTarget?: TaskWindowTabTarget
): Promise<boolean> {
  const request = ++latestOpenRequest;
  const startedAt = performance.now();
  const hardDeadline = startedAt + TASK_OPEN_HARD_TIMEOUT_MS;
  const performanceContext = getTaskOpenPerformanceContext(projectId, taskId);
  let navigationLease = currentNavigationLease();
  const isCurrentRequest = () =>
    request === latestOpenRequest && isNavigationLeaseCurrent(navigationLease);
  const commitTaskRoute = (
    target: TaskWindowTabTarget,
    selection: DeferredTaskTabSelection
  ): boolean => {
    // The internal tab and its top-level route must become authoritative in
    // one synchronous turn. The selection owns the bridge guard, so this does
    // not echo back into a second route intent.
    if (!selection.activate()) return false;
    try {
      appState.appTabs.openTaskScope(projectId, taskId, target);
    } finally {
      // openTaskScope owns this navigation. Renew the lease after all of its
      // synchronous route/tab reactions settle so later awaits can distinguish
      // an external leave-and-return from this request's own commit.
      navigationLease = currentNavigationLease();
    }
    return true;
  };
  let stagedRouteKey: string | null = null;
  let selectionForLoadingRoute: DeferredTaskTabSelection | null = null;
  let beginLoadingTransition: (() => void) | null = null;
  let abandonHotRevealForLoading: (() => void) | null = null;
  const commitStagingRoute = (
    stagingTarget: TaskWindowTabTarget,
    selection: DeferredTaskTabSelection
  ): boolean => {
    if (!isCurrentRequest()) return false;
    const key = JSON.stringify(stagingTarget);
    if (stagedRouteKey === key) return true;
    beginLoadingTransition?.();
    if (!commitTaskRoute(stagingTarget, selection)) return false;
    stagedRouteKey = key;
    markTaskOpenTrace(projectId, taskId, 'loading-route-committed', {
      target: stagingTarget.kind,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    return true;
  };
  const commitLoadingRoute = (): void => {
    if (!isCurrentRequest()) return;
    abandonHotRevealForLoading?.();
    if (target) {
      if (selectionForLoadingRoute && asProvisioned(getTaskStore(projectId, taskId))) {
        if (commitStagingRoute(target, selectionForLoadingRoute)) return;
      }
    }
    beginLoadingTransition?.();
    _navigate('task', { projectId, taskId });
    navigationLease = currentNavigationLease();
    stagedRouteKey = 'task-scope';
    markTaskOpenTrace(projectId, taskId, 'loading-route-committed', {
      target: 'opening',
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  };
  /**
   * Route to the task scope itself, with no tab target. A task IS its session:
   * when no session tab resolves (a task with zero sessions, or a target that
   * failed to hydrate) there is no destination page to stage — the view renders
   * its own session landing surface.
   */
  const commitTaskScopeRoute = (): boolean => {
    if (!isCurrentRequest()) return false;
    abandonHotRevealForLoading?.();
    selectionForLoadingRoute = null;
    _navigate('task', { projectId, taskId });
    navigationLease = currentNavigationLease();
    stagedRouteKey = 'task-scope';
    markTaskOpenTrace(projectId, taskId, 'route-committed', { target: 'task-scope' });
    return true;
  };
  const waitForStagingRoute = async (
    stagingTarget: TaskWindowTabTarget,
    selection: DeferredTaskTabSelection
  ): Promise<boolean> => {
    if (stagedRouteKey === JSON.stringify(stagingTarget)) return isCurrentRequest();
    if (!isCurrentRequest()) return false;
    if (!commitStagingRoute(stagingTarget, selection)) return false;
    // Let React commit the opaque destination and register its task-keyed pane
    // before the manager begins its bounded layout wait.
    await Promise.resolve();
    return isCurrentRequest();
  };
  const scheduleLoadingRoute = (): ReturnType<typeof setTimeout> =>
    setTimeout(
      commitLoadingRoute,
      Math.max(0, TASK_OPEN_LOADING_THRESHOLD_MS - (performance.now() - startedAt))
    );
  const remainingHardBudget = () => Math.max(0, hardDeadline - performance.now());
  const remainingSessionStagingBudget = () =>
    Math.min(
      Math.max(
        TASK_OPEN_SESSION_STAGING_FLOOR_MS,
        startedAt + TASK_OPEN_SESSION_STAGING_DEADLINE_MS - performance.now()
      ),
      remainingHardBudget()
    );
  let target: TaskWindowTabTarget | undefined = explicitTarget;
  const initialTaskStore = getTaskStore(projectId, taskId);
  let provisioned = asProvisioned(initialTaskStore);
  markTaskOpenTrace(projectId, taskId, 'store-resolved', {
    provisioned: Boolean(provisioned),
    explicitTarget: explicitTarget?.kind ?? null,
  });

  // The normal task-row path is already provisioned. Hydrate the remembered
  // target without touching the current tab while a hot terminal acquires its
  // canonical reveal claim. Selection and routing commit together afterwards.
  if (provisioned) {
    target ??= resolveLastTaskSessionTarget(
      appState.history,
      provisioned.taskView.tabManager,
      projectId,
      taskId
    );
    if (!target) return commitTaskScopeRoute();
    markTaskOpenTrace(projectId, taskId, 'target-resolved', { target: target.kind });
    // Attach the rejection handler immediately. The reveal claim below may be
    // pending while hydration fails; that failure must not escape globally.
    const selectionPromise = captureTaskTargetOpen(
      openProvisionedTaskTab(provisioned, target, {
        shouldApply: isCurrentRequest,
        topLevelMode: 'internal',
        deferSelection: true,
      })
    );
    markTaskOpenTrace(projectId, taskId, 'target-hydrating', { target: target.kind });

    const cachedConversation =
      target.kind === 'conversation'
        ? provisioned.conversations.conversations.get(target.conversationId)
        : undefined;
    const hotPty = cachedConversation?.session.pty ?? null;
    let hasHotRevealClaim = false;
    let keepHotRevealClaim = false;
    let transitionLease: symbol | null = null;
    beginLoadingTransition = () => {
      transitionLease ??= taskOpenTransitionStore.begin(projectId, taskId);
    };
    abandonHotRevealForLoading = () => {
      if (!hasHotRevealClaim) return;
      hotPty?.invalidateHotReveal();
      hasHotRevealClaim = false;
    };
    // Target hydration is independent of the hot generation claim. Publishing
    // its outcome lets the safety timer stage a target-less loader only while
    // hydration is still genuinely unknown. Once both outcomes are known, the
    // resolved target bypasses the timer and mounts for staging immediately.
    void selectionPromise.then((outcome) => {
      if (outcome.ok && isCurrentRequest()) selectionForLoadingRoute = outcome.selection;
    });
    const loadingRouteTimer = scheduleLoadingRoute();
    try {
      if (target.kind === 'conversation' && hotPty?.canRevealImmediately) {
        // This is an atomic main/renderer generation lease, not a snapshot
        // check: no replacement PTY can register between the answer and a hot
        // route commit. If the loader boundary wins first, the timer revokes it
        // and the ordinary hidden-staging path prepares a fresh generation.
        try {
          hasHotRevealClaim = await hotPty.acquireCanonicalRevealClaim(isCurrentRequest);
        } catch {
          hasHotRevealClaim = false;
        }
        if (!hasHotRevealClaim) hotPty.invalidateHotReveal();
        if (stagedRouteKey !== null) abandonHotRevealForLoading();
      } else if (target.kind === 'conversation' && hotPty) {
        hotPty.invalidateHotReveal();
      }
      if (!isCurrentRequest()) return false;

      const selection = unwrapTaskTargetOpen(
        await waitForTaskOpenStep(selectionPromise, isCurrentRequest, hardDeadline)
      );
      if (!isCurrentRequest()) {
        return false;
      }
      if (!selection.found) return commitTaskScopeRoute();
      selectionForLoadingRoute = selection;

      if (
        target.kind === 'conversation' &&
        hasHotRevealClaim &&
        stagedRouteKey === null &&
        hotPty?.canRevealImmediately
      ) {
        if (!commitTaskRoute(target, selection)) return false;
        keepHotRevealClaim = true;
        markTaskOpenTrace(projectId, taskId, 'route-committed', { target: target.kind });
        return true;
      }

      abandonHotRevealForLoading();
      if (target.kind === 'conversation') {
        const conversationId = target.conversationId;
        if (!(await waitForStagingRoute(target, selection))) return false;
        // Mount the real destination layout under the opaque opening surface
        // before measuring or resizing its terminal. This turns the route into
        // a staging host, not a channel for PTY bootstrap internals.
        const frameReady = performanceContext
          ? await provisioned.conversations.prepareConversationForOpen(
              cachedConversation?.data.id ?? conversationId,
              isCurrentRequest,
              remainingSessionStagingBudget(),
              performanceContext
            )
          : await provisioned.conversations.prepareConversationForOpen(
              cachedConversation?.data.id ?? conversationId,
              isCurrentRequest,
              remainingSessionStagingBudget()
            );
        if (!frameReady && isCurrentRequest()) {
          // A busy TUI can keep producing complete frames without ever giving
          // off-screen preparation its fallback quiet window. The destination
          // is already mounted beneath TaskMainPanel's opaque opening surface,
          // so hand readiness ownership to ConversationSession instead of
          // converting a still-live session into a terminal navigation error.
          // Its generation-aware visible-frame loop keeps the same full-panel
          // surface in place and retries until a browser-painted frame or a
          // real connection error becomes authoritative.
          markTaskOpenTrace(projectId, taskId, 'canonical-frame-deferred', {
            target: target.kind,
          });
        }
      } else if (stagedRouteKey !== JSON.stringify(target) && !commitTaskRoute(target, selection)) {
        return false;
      }
      if (!isCurrentRequest()) return false;
      markTaskOpenTrace(projectId, taskId, 'route-committed', { target: target.kind });
      return true;
    } catch (error) {
      if (!isCurrentRequest()) return false;
      const failureStage: TaskOpenFailureStage =
        stagedRouteKey !== null || !hasHotRevealClaim
          ? 'stage-provisioned-target'
          : 'open-provisioned-target';
      log.warn(
        failureStage === 'stage-provisioned-target'
          ? 'Failed to stage provisioned task target'
          : 'Failed to open provisioned task target',
        { projectId, taskId, target, error }
      );
      if (stagedRouteKey !== null && transitionLease && target) {
        taskOpenTransitionStore.fail(projectId, taskId, transitionLease, target, error);
      }
      notifyTaskOpenFailure(projectId, taskId, target, failureStage, error);
      return false;
    } finally {
      clearTimeout(loadingRouteTimer);
      if (hasHotRevealClaim && !keepHotRevealClaim) hotPty?.invalidateHotReveal();
      if (transitionLease && !taskOpenTransitionStore.hasFailed(projectId, taskId)) {
        taskOpenTransitionStore.complete(projectId, taskId, transitionLease);
      }
    }
  }

  // Keep the current task visible while the destination is provisioned and its
  // terminal frame is staged off-screen. Route state is the commit boundary,
  // not a progress channel for workspace/session bootstrap internals.
  const transitionLease = taskOpenTransitionStore.begin(projectId, taskId);
  // Provisioning has no destination layout to stage yet. Preserve the current
  // task for the short threshold, but do not make a fast provisioned target
  // wait for it: waitForStagingRoute commits that target as soon as selection
  // hydration completes.
  const loadingRouteTimer = scheduleLoadingRoute();
  let pendingProvision: Promise<void> | null = null;

  try {
    await waitForTaskOpenStep(
      prepareExplicitTaskOpen(projectId, taskId),
      isCurrentRequest,
      hardDeadline
    );
    markTaskOpenTrace(projectId, taskId, 'task-prepared');
    if (!isCurrentRequest()) return false;

    const taskManager = getTaskManagerStore(projectId);
    if (!taskManager) throw new Error(`Project ${projectId} could not be mounted`);
    pendingProvision = taskManager.provisionTask(taskId);
    await waitForTaskOpenStep(pendingProvision, isCurrentRequest, hardDeadline);
    markTaskOpenTrace(projectId, taskId, 'task-provisioned');
    if (!isCurrentRequest()) return false;

    provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (!provisioned) throw new Error(`Task ${taskId} could not be provisioned`);

    target ??= resolveLastTaskSessionTarget(
      appState.history,
      provisioned.taskView.tabManager,
      projectId,
      taskId
    );
    if (!target) return commitTaskScopeRoute();
    markTaskOpenTrace(projectId, taskId, 'target-resolved', { target: target.kind });

    const selection = await waitForTaskOpenStep(
      openProvisionedTaskTab(provisioned, target, {
        shouldApply: isCurrentRequest,
        topLevelMode: 'internal',
        deferSelection: true,
      }),
      isCurrentRequest,
      hardDeadline
    );
    markTaskOpenTrace(projectId, taskId, 'target-hydrated', { target: target.kind });
    if (!isCurrentRequest()) return false;
    if (!selection.found) return commitTaskScopeRoute();
    selectionForLoadingRoute = selection;

    if (target.kind === 'conversation') {
      if (!(await waitForStagingRoute(target, selection))) return false;
      const frameReady = performanceContext
        ? await provisioned.conversations.prepareConversationForOpen(
            target.conversationId,
            isCurrentRequest,
            remainingSessionStagingBudget(),
            performanceContext
          )
        : await provisioned.conversations.prepareConversationForOpen(
            target.conversationId,
            isCurrentRequest,
            remainingSessionStagingBudget()
          );
      if (!frameReady && isCurrentRequest()) {
        markTaskOpenTrace(projectId, taskId, 'canonical-frame-deferred', {
          target: target.kind,
        });
      }
      if (!isCurrentRequest()) return false;
    }

    if (stagedRouteKey !== JSON.stringify(target) && !commitTaskRoute(target, selection)) {
      return false;
    }
    markTaskOpenTrace(projectId, taskId, 'route-committed', { target: target.kind });

    return true;
  } catch (error) {
    if (error instanceof TaskOpenCancelledError || !isCurrentRequest()) return false;
    if (error instanceof TaskOpenDeadlineError && pendingProvision) {
      // The hard deadline bounds the opaque Logo, not the workspace operation.
      // Keep the epoch-bound RPC alive so a late success can still transition
      // the TaskStore to ready; only publish the existing retryable error view.
      getTaskManagerStore(projectId)?.markProvisionPresentationTimedOut(
        taskId,
        pendingProvision,
        TASK_OPEN_HARD_TIMEOUT_MS
      );
    }
    // Only a ready conversation has a hidden terminal worth preserving behind
    // the staging error surface. Provision/mount failures must release the
    // lease so the existing TaskProvisionRecovery UI can become reachable.
    if (stagedRouteKey !== null && provisioned && target?.kind === 'conversation') {
      taskOpenTransitionStore.fail(projectId, taskId, transitionLease, target, error);
    }
    log.warn('Failed to prepare task before opening', { projectId, taskId, error });
    notifyTaskOpenFailure(projectId, taskId, target, 'prepare-cold-task', error);
    return false;
  } finally {
    clearTimeout(loadingRouteTimer);
    if (!taskOpenTransitionStore.hasFailed(projectId, taskId)) {
      taskOpenTransitionStore.complete(projectId, taskId, transitionLease);
    }
  }
}
