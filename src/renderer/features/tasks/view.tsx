import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { openProvisionedTaskTab, openTaskTopTab } from '@renderer/app/open-task-target';
import { type ViewDefinition } from '@renderer/app/view-registry';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  TaskViewWrapper,
  useRequireProvisionedTask,
} from '@renderer/features/tasks/task-view-context';
import { events } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { routeKey } from '@renderer/lib/stores/app-tabs-store';
import { log } from '@renderer/utils/logger';
import { createTaskCommandProvider } from './commands';
import { EditorProvider } from './editor/editor-provider';
import { useIsActiveTask } from './hooks/use-is-active-task';
import { TaskMainPanel } from './main-panel';
import { markTaskOpenTrace } from './task-open-performance';
import { taskOpenTransitionStore } from './task-open-transition-store';
import { TaskTitlebar } from './task-titlebar';
import { shouldResolveTaskScopeEntry } from './task-view-opening';

/**
 * Syncs TabManagerStore.isVisible with the active task state.
 * Controls telemetry conversation scope.
 */
const TabManagerVisibilitySync = observer(function TabManagerVisibilitySync({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { taskView } = useRequireProvisionedTask();
  const isActive = useIsActiveTask(taskId);
  const activeConversationId = taskView.tabManager.activeConversationId;
  const { navigate } = useNavigate();

  useEffect(() => {
    taskView.tabManager.setVisible(isActive);
    return () => {
      taskView.tabManager.setVisible(false);
    };
  }, [taskView.tabManager, isActive]);

  // Drafts tasks replace the old projectless view; when their active agent
  // process exits, return to home instead of leaving an empty task shell open.
  useEffect(() => {
    if (!isActive || projectId !== INTERNAL_PROJECT_ID || !activeConversationId) return;
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.projectId !== projectId) return;
      if (event.taskId !== taskId) return;
      if (event.conversationId !== activeConversationId) return;
      navigate('home');
    });
  }, [activeConversationId, isActive, navigate, projectId, taskId]);

  return null;
});

/**
 * Phase 2 bridge between top-level app tabs and the task's internal tab state.
 *
 * Downward: reacts to the route's `tab` target and replays it onto the internal
 * TabManagerStore via openProvisionedTaskTab (with re-entrancy guard so the
 * replay doesn't bounce back up).
 *
 * Upward: injects the bridge into TabManagerStore so internal open/activate
 * intents (sidebar lists, file tree, terminals, …) surface as top-level tabs.
 */
const TopLevelTabSync = observer(function TopLevelTabSync({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const provisioned = useRequireProvisionedTask();
  const isActive = useIsActiveTask(taskId);
  const { params } = useParams('task');
  const tabManager = provisioned.taskView.tabManager;
  // Re-run the replay on every openTab, even for an unchanged route — clicking
  // the same session again must re-align internal state.
  const replayNonce = appState.appTabs.replayNonce;
  const isTargetPending = taskOpenTransitionStore.isPending(projectId, taskId);
  const failedTarget = taskOpenTransitionStore.failedTarget(projectId, taskId);

  // The route's target only applies while this task IS the routed task. A
  // tab-less route is a scope entry — resolved by the effect below to the
  // task's own last-active tab, never treated as an overview target itself.
  const isRoutedTask = isActive && params.taskId === taskId;
  const target: TaskWindowTabTarget | null = isRoutedTask ? (params.tab ?? null) : null;
  const targetKey = target ? JSON.stringify(target) : null;

  useLayoutEffect(() => {
    const bridge = {
      applying: null as { key: string; token: symbol } | null,
      open: (tab: TaskWindowTabTarget) => openTaskTopTab(projectId, taskId, tab),
    };
    tabManager.topLevelBridge = bridge;
    return () => {
      if (tabManager.topLevelBridge === bridge) tabManager.topLevelBridge = null;
    };
  }, [tabManager, projectId, taskId]);

  // The first task frame must already point at the task's internal target.
  // A passive effect runs after the browser may have painted the overview or
  // conversation list, which creates a visible intermediate frame on cold
  // task entry. Layout timing keeps this handoff inside the same paint.
  useLayoutEffect(() => {
    if (!isRoutedTask) return;

    // A failed conversation opener owns only that route target. A deliberate
    // switch to another tab in the same task is a new user intent and must
    // immediately release the failed overlay instead of being suppressed.
    if (failedTarget && target && JSON.stringify(failedTarget) !== JSON.stringify(target)) {
      taskOpenTransitionStore.dismissFailure(projectId, taskId);
    }

    // One owner resolves the route intent. An explicit route always wins and
    // discards pre-bridge intents. A target-less scope entry consumes the
    // pending initial conversation exactly once, then falls back to the task's
    // restored active tab. Keeping this in one effect prevents scope restore
    // and bridge mount from opening the same session twice.
    const shouldResolveScopeEntry = shouldResolveTaskScopeEntry(target, isTargetPending);
    // The explicit opener owns every loader route, including one whose final
    // target is already known. It has synchronously selected the internal tab;
    // replaying it here would forward through the bridge and invalidate the
    // opener's navigation lease before canonical-frame staging completes.
    if (isTargetPending) return;

    const pending = tabManager.flushPendingTopLevelTarget();
    if (shouldResolveScopeEntry) {
      openTaskTopTab(
        projectId,
        taskId,
        pending ??
          tabManager.activeTopLevelTarget ??
          tabManager.preferredConversationTarget ?? { kind: 'overview' }
      );
      return;
    }
    if (!target || !targetKey) return;

    log.debug('[tab-sync] replay: applying route target', { projectId, taskId, target });
    let cancelled = false;
    const bridge = tabManager.topLevelBridge;
    if (!bridge) return;
    const replayToken = Symbol(targetKey);
    const routeIsCurrent = () => {
      if (cancelled || appState.navigation.currentViewId !== 'task') return false;
      const current = appState.navigation.viewParamsStore.task as
        | { projectId?: string; taskId?: string; tab?: TaskWindowTabTarget }
        | undefined;
      return (
        current?.projectId === projectId &&
        current.taskId === taskId &&
        JSON.stringify(current.tab) === targetKey
      );
    };
    if (!routeIsCurrent()) return;
    bridge.applying = { key: targetKey, token: replayToken };
    void openProvisionedTaskTab(provisioned, target, { shouldApply: routeIsCurrent })
      .then((found) => {
        if (!routeIsCurrent()) return;
        log.debug('[tab-sync] replay: result', {
          target: JSON.parse(targetKey),
          found,
          cancelled,
          postAlign: {
            activeTabId: tabManager.activeTabId,
            activeConversationId: tabManager.activeConversationId,
            activeRenderer: provisioned.taskView.activeRenderer,
            isVisible: tabManager.isVisible,
          },
        });
        if (found) return;
        log.warn('TopLevelTabSync: replay target could not be materialized', {
          projectId,
          taskId,
          target,
        });
        // The target cannot be materialized (e.g. an archived/deleted
        // conversation). Remove the dangling top-level tab — otherwise the
        // strip and the rendered content diverge: the tab stays selectable
        // forever while the panel keeps showing whatever was active before.
        const danglingKey = routeKey('task', { projectId, taskId, tab: target });
        appState.appTabs.closeTabsWhere(
          (entry) => routeKey(entry.viewId, entry.params) === danglingKey
        );
      })
      .catch((error: unknown) => {
        if (!routeIsCurrent()) return;
        log.warn('TopLevelTabSync: replay failed', { projectId, taskId, target, error });
      })
      .finally(() => {
        // Only clear our own replay — a newer replay may target the same key.
        if (bridge.applying?.token === replayToken) bridge.applying = null;
      });
    return () => {
      // A newer target superseded this replay mid-flight (rapid clicks):
      // never remove the newer route's tab based on a stale result.
      cancelled = true;
    };
    // targetKey is the stable identity of `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    failedTarget,
    isRoutedTask,
    isTargetPending,
    targetKey,
    replayNonce,
    provisioned,
    tabManager,
    projectId,
    taskId,
  ]);

  // Lifecycle: close top-level tabs whose conversation was archived/deleted.
  // An unhydrated manager starts with an empty map, so wait for a completed
  // backend snapshot before treating an absent id as deletion. Otherwise a
  // task switch can briefly erase its persisted session tab before loading
  // restores the conversation list.
  useEffect(
    () =>
      reaction(
        () => ({
          hasAuthoritativeSnapshot: provisioned.conversations.hasAuthoritativeSnapshot,
          conversationIds: [...provisioned.conversations.conversations.keys()].sort().join('\n'),
        }),
        ({ hasAuthoritativeSnapshot }) => {
          if (!hasAuthoritativeSnapshot) return;
          const ids = new Set(provisioned.conversations.conversations.keys());
          appState.appTabs.closeTabsWhere((tab) => {
            if (tab.viewId !== 'task') return false;
            const params = tab.params as {
              projectId?: string;
              taskId?: string;
              tab?: TaskWindowTabTarget;
            };
            return (
              params.projectId === projectId &&
              params.taskId === taskId &&
              params.tab?.kind === 'conversation' &&
              !ids.has(params.tab.conversationId)
            );
          });
        },
        { fireImmediately: true }
      ),
    [provisioned, projectId, taskId]
  );

  return null;
});

export const TaskViewWrapperWithProviders = observer(function TaskViewWrapperWithProviders({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
  /** Top-level tab target (Phase 2): which internal tab this route shows. */
  tab?: TaskWindowTabTarget;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const provisioned = asProvisioned(taskStore);

  useLayoutEffect(() => {
    markTaskOpenTrace(projectId, taskId, 'view-wrapper-committed', { kind });
  }, [kind, projectId, taskId]);

  // A direct route can arrive before a lazily mounted project has populated
  // its task map. Point-load the target from this one owner so `missing` is a
  // short, coherent opening phase rather than an empty intermediate frame.
  useLayoutEffect(() => {
    if (kind !== 'missing') return;
    void getTaskManagerStore(projectId)
      ?.ensureTaskLoaded(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId]);

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  // Archived tasks included: archiving is organizational, so it must not decide
  // whether a task can run. Provisioning rebuilds the worktree from the branch
  // archiving left behind.
  useEffect(() => {
    if (kind !== 'idle') return;

    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId]);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId} kind={kind}>
        {children}
      </TaskViewWrapper>
    );
  }

  // `kind` and the provider payload are captured in this render. Never let a
  // nested provider re-read mutable task state and disagree with this branch.
  if (!provisioned) return null;

  return (
    <TaskViewWrapper
      projectId={projectId}
      taskId={taskId}
      kind={kind}
      provisionedTask={provisioned}
    >
      <TabManagerVisibilitySync projectId={projectId} taskId={taskId} />
      <TopLevelTabSync projectId={projectId} taskId={taskId} />
      <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
        {children}
      </EditorProvider>
    </TaskViewWrapper>
  );
});

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  commandProvider: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
    createTaskCommandProvider(projectId, taskId),
} satisfies ViewDefinition<{ projectId: string; taskId: string; tab?: TaskWindowTabTarget }>;
