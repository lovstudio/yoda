import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import type { TaskWindowTabTarget } from '@shared/task-window';
import { openProvisionedTaskTab, openTaskTopTab } from '@renderer/app/open-task-target';
import { type ViewDefinition } from '@renderer/app/view-registry';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
  useProvisionedTask,
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
import { TaskTitlebar } from './task-titlebar';

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
  const { taskView } = useProvisionedTask();
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
  const provisioned = useProvisionedTask();
  const isActive = useIsActiveTask(taskId);
  const { params } = useParams('task');
  const tabManager = provisioned.taskView.tabManager;
  // Re-run the replay on every openTab, even for an unchanged route — clicking
  // the same session again must re-align internal state.
  const replayNonce = appState.appTabs.replayNonce;

  // The route's target only applies while this task IS the routed task. A
  // tab-less route is a scope entry — resolved by the effect below to the
  // task's own last-active tab, never treated as an overview target itself.
  const isRoutedTask = isActive && params.taskId === taskId;
  const target: TaskWindowTabTarget | null = isRoutedTask ? (params.tab ?? null) : null;
  const targetKey = target ? JSON.stringify(target) : null;
  const isScopeEntry = isRoutedTask && params.tab === undefined;

  // Scope entry: rewrite the route with the task's last-active internal tab
  // (restored by TabManagerStore's snapshot) instead of forcing the overview.
  // openTaskTopTab re-applies the route with an explicit target, which the
  // replay effect below then aligns — and, for overview, normalizes the stored
  // index tab's tab-less params to the explicit shape.
  useEffect(() => {
    if (!isScopeEntry) return;
    openTaskTopTab(projectId, taskId, tabManager.activeTopLevelTarget ?? { kind: 'overview' });
  }, [isScopeEntry, replayNonce, tabManager, projectId, taskId]);

  useEffect(() => {
    const bridge = {
      applyingKey: null as string | null,
      open: (tab: TaskWindowTabTarget) => openTaskTopTab(projectId, taskId, tab),
    };
    tabManager.topLevelBridge = bridge;
    // Surface open intents that happened before the bridge mounted (e.g. the
    // initial conversation opened during provisioning) — a fresh task lands on
    // its session tab, not the overview.
    const pending = tabManager.flushPendingTopLevelTarget();
    if (pending) openTaskTopTab(projectId, taskId, pending);
    return () => {
      if (tabManager.topLevelBridge === bridge) tabManager.topLevelBridge = null;
    };
  }, [tabManager, projectId, taskId]);

  useEffect(() => {
    if (!target || !targetKey) return;
    log.debug('[tab-sync] replay: applying route target', { projectId, taskId, target });
    let cancelled = false;
    const bridge = tabManager.topLevelBridge;
    if (bridge) bridge.applyingKey = targetKey;
    void openProvisionedTaskTab(provisioned, target)
      .then((found) => {
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
        if (cancelled) return;
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
        log.warn('TopLevelTabSync: replay failed', { projectId, taskId, target, error });
      })
      .finally(() => {
        // Only clear our own key — a newer replay may have set its own.
        if (bridge && bridge.applyingKey === targetKey) bridge.applyingKey = null;
      });
    return () => {
      // A newer target superseded this replay mid-flight (rapid clicks):
      // never remove the newer route's tab based on a stale result.
      cancelled = true;
    };
    // targetKey is the stable identity of `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, replayNonce, provisioned, tabManager]);

  // Lifecycle: close top-level tabs whose conversation was archived/deleted.
  // fireImmediately also sweeps STALE persisted tabs on mount (e.g. ghosts
  // created before ownership guards existed).
  useEffect(
    () =>
      reaction(
        () => [...provisioned.conversations.conversations.keys()].sort().join('\n'),
        () => {
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

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;

    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId}>
        {children}
      </TaskViewWrapper>
    );
  }

  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId}>
      <ProvisionedTaskProvider projectId={projectId} taskId={taskId}>
        <TabManagerVisibilitySync projectId={projectId} taskId={taskId} />
        <TopLevelTabSync projectId={projectId} taskId={taskId} />
        <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
          {children}
        </EditorProvider>
      </ProvisionedTaskProvider>
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
