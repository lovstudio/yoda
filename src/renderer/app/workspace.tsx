import { FilePlus2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AppSidePane } from '@renderer/app/app-side-pane';
import { moveDraggedTabToStrip } from '@renderer/app/open-task-target';
import { useTabDropZone } from '@renderer/app/tab-drag';
import { useExternalFileDrop } from '@renderer/app/use-external-file-drop';
import { WorkspaceNotificationEvents } from '@renderer/app/workspace-notification-events';
import { WorkspaceRuntimeBar } from '@renderer/app/workspace-runtime-bar';
import { WorkspaceTerminalPanel } from '@renderer/app/workspace-terminal-panel';
import { LeftSidebar } from '@renderer/features/sidebar/left-sidebar';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import { TiledTaskGrid } from '@renderer/features/tasks/split-view/tiled-task-grid';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { ErrorBoundary } from '@renderer/lib/components/error-boundary';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { QuitAgentSessionsPrompt } from '@renderer/lib/components/quit-agent-sessions-prompt';
import { TmuxUnavailableNotifier } from '@renderer/lib/components/tmux-unavailable-notifier';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import {
  workspaceRouteSnapshot,
  type WorkspaceRouteSnapshot,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { Toaster } from '@renderer/lib/ui/toaster';
import { cn } from '@renderer/utils/utils';

/**
 * Global top-level tab shortcuts (Mod+W, Mod+Alt+arrows, Mod+1-9). Yields to
 * panels that bind the same keys for their own tab sets (e.g. the task
 * terminal drawer when the bottom region is focused).
 */
const GlobalTabShortcuts = observer(function GlobalTabShortcuts() {
  const { currentViewId, viewParamsStore } = appState.navigation;
  let focused = true;
  if (currentViewId === 'task') {
    const params = viewParamsStore.task as { projectId?: string; taskId?: string } | undefined;
    const provisioned =
      params?.projectId && params.taskId
        ? asProvisioned(getTaskStore(params.projectId, params.taskId))
        : undefined;
    if (provisioned?.taskView.focusedRegion === 'bottom') focused = false;
  }
  useTabShortcuts(appState.appTabs, { focused });
  return null;
});

export const Workspace = observer(function Workspace() {
  useTheme();
  // Read the route while this observer is rendering. The old hook subscribes
  // after render, which lets a route change from a task to a global view
  // briefly pair an old task panel with the new view's wrapper.
  const routeSnapshot = workspaceRouteSnapshot();

  return (
    <>
      <AppKeyboardShortcuts />
      <GlobalTabShortcuts />
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <TmuxUnavailableNotifier />
      <QuitAgentSessionsPrompt />
      <WorkspaceNotificationEvents />
      <WorkspaceLayout
        leftSidebar={
          <ErrorBoundary variant="inline" componentName="LeftSidebar">
            <LeftSidebar />
          </ErrorBoundary>
        }
        mainContent={<WorkspaceRouteCache snapshot={routeSnapshot} />}
        rightPane={
          appState.sidePane.isVisible ? (
            <ErrorBoundary variant="inline" componentName="AppSidePane">
              <AppSidePane />
            </ErrorBoundary>
          ) : null
        }
      />
      <Toaster />
    </>
  );
});

const TASK_ROUTE_CACHE_LIMIT = 2;

type CachedTaskRoute = WorkspaceRouteSnapshot & {
  key: string;
  projectId: string;
  taskId: string;
  lastUsed: number;
};

/**
 * Keep the current and previous task trees warm. Task stores already outlive
 * navigation, but remounting their full provider/layout/terminal tree still
 * makes a sidebar switch feel like a reload. React Activity pauses effects for
 * the hidden task while retaining its DOM and component state, so returning to
 * it only flips visibility. The two-entry bound keeps this from growing with
 * the number of tasks visited.
 */
const WorkspaceRouteCache = observer(function WorkspaceRouteCache({
  snapshot,
}: {
  snapshot: WorkspaceRouteSnapshot;
}) {
  const taskRoutesRef = useRef<CachedTaskRoute[]>([]);
  const usageSequenceRef = useRef(0);
  const currentTaskKey =
    snapshot.currentView === 'task' &&
    typeof snapshot.wrapParams.projectId === 'string' &&
    typeof snapshot.wrapParams.taskId === 'string'
      ? `${snapshot.wrapParams.projectId}:${snapshot.wrapParams.taskId}`
      : null;

  if (currentTaskKey) {
    const projectId = snapshot.wrapParams.projectId as string;
    const taskId = snapshot.wrapParams.taskId as string;
    const lastUsed = ++usageSequenceRef.current;
    const existing = taskRoutesRef.current.find((entry) => entry.key === currentTaskKey);
    if (existing) {
      existing.WrapView = snapshot.WrapView;
      existing.TitlebarSlot = snapshot.TitlebarSlot;
      existing.MainPanel = snapshot.MainPanel;
      existing.wrapParams = { projectId, taskId };
      existing.lastUsed = lastUsed;
    } else {
      taskRoutesRef.current.push({
        ...snapshot,
        key: currentTaskKey,
        projectId,
        taskId,
        wrapParams: { projectId, taskId },
        lastUsed,
      });
    }

    while (taskRoutesRef.current.length > TASK_ROUTE_CACHE_LIMIT) {
      let oldestIndex = 0;
      for (let index = 1; index < taskRoutesRef.current.length; index++) {
        if (taskRoutesRef.current[index]!.lastUsed < taskRoutesRef.current[oldestIndex]!.lastUsed) {
          oldestIndex = index;
        }
      }
      taskRoutesRef.current.splice(oldestIndex, 1);
    }
  }

  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      {taskRoutesRef.current.map((taskRoute) => (
        <Activity
          key={taskRoute.key}
          mode={currentTaskKey === taskRoute.key ? 'visible' : 'hidden'}
        >
          <WorkspaceRouteSurface snapshot={taskRoute} routeBoundaryKey={`task:${taskRoute.key}`} />
        </Activity>
      ))}
      {snapshot.currentView !== 'task' ? (
        <WorkspaceRouteSurface
          key={snapshot.currentView}
          snapshot={snapshot}
          routeBoundaryKey={snapshot.currentView}
        />
      ) : null}
    </div>
  );
});

function WorkspaceRouteSurface({
  snapshot,
  routeBoundaryKey,
}: {
  snapshot: WorkspaceRouteSnapshot;
  routeBoundaryKey: string;
}) {
  const { WrapView, TitlebarSlot, MainPanel, currentView, wrapParams } = snapshot;

  return (
    <WrapView key={routeBoundaryKey} {...wrapParams}>
      <ErrorBoundary variant="inline" componentName="ModalRenderer">
        <ModalRenderer />
      </ErrorBoundary>
      <ErrorBoundary variant="inline" componentName="WorkspaceView">
        <WorkspaceViewContent
          TitlebarSlot={TitlebarSlot}
          MainPanel={MainPanel}
          currentView={currentView}
        />
      </ErrorBoundary>
    </WrapView>
  );
}

const WorkspaceViewContent = observer(function WorkspaceViewContent({
  TitlebarSlot,
  MainPanel,
  currentView,
}: Pick<WorkspaceRouteSnapshot, 'TitlebarSlot' | 'MainPanel' | 'currentView'>) {
  // Tile extra tasks beside the routed one — only on the task view, and only
  // while extras exist. The primary keeps the outer route providers (it IS
  // <MainPanel/>); the grid hosts the self-contained extras.
  const isTiled = currentView === 'task' && splitViewStore.count > 0;

  // The whole central column — on every route — accepts a dragged pin (task
  // sidebar / shell pane): dropping "into the main window" means "show it
  // here", so the tab returns to its strip AND activates (cross-scope drops
  // would otherwise vanish from sight). Inner strips keep priority via the
  // innermost-zone rule in tab-drag.
  const { isOver, dropRef } = useTabDropZone({
    canDrop: (payload) =>
      (payload.kind === 'task-entity' && payload.from !== 'strip') || payload.kind === 'shell-pin',
    onDrop: moveDraggedTabToStrip,
  });
  const { t } = useTranslation();
  const externalFileDrop = useExternalFileDrop();

  return (
    <div
      ref={dropRef}
      className={cn(
        'relative h-full min-h-0 overflow-hidden',
        isOver && 'ring-2 ring-inset ring-border-primary'
      )}
      onDragEnter={externalFileDrop.onDragEnter}
      onDragLeave={externalFileDrop.onDragLeave}
      onDragOver={externalFileDrop.onDragOver}
      onDrop={externalFileDrop.onDrop}
    >
      {externalFileDrop.isDragOver ? (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-lg border border-dashed border-primary/70 bg-background/80 shadow-lg backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-center">
            <FilePlus2 className="size-7 text-primary" />
            <p className="text-sm font-medium text-foreground">{t('externalFileDrop.title')}</p>
            <p className="text-xs text-foreground-muted">{t('externalFileDrop.description')}</p>
          </div>
        </div>
      ) : null}
      <WorkspaceContentLayout
        titlebarSlot={<TitlebarSlot />}
        mainPanel={isTiled ? <TiledTaskGrid primary={<MainPanel />} /> : <MainPanel />}
        bottomBar={<WorkspaceRuntimeBar />}
        bottomPane={<WorkspaceTerminalPanel />}
        isBottomPaneOpen={workspaceTerminalStore.isOpen}
        onBottomPaneOpenChange={(open) => {
          if (!open) workspaceTerminalStore.close();
        }}
      />
    </div>
  );
});
