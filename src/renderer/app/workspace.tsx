import { observer } from 'mobx-react-lite';
import { AppSidePane } from '@renderer/app/app-side-pane';
import { moveDraggedTabToStrip } from '@renderer/app/open-task-target';
import { useTabDropZone } from '@renderer/app/tab-drag';
import { LeftSidebar } from '@renderer/features/sidebar/left-sidebar';
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
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { appState } from '@renderer/lib/stores/app-state';
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
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();

  return (
    <>
      <AppKeyboardShortcuts />
      <GlobalTabShortcuts />
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <TmuxUnavailableNotifier />
      <QuitAgentSessionsPrompt />
      <WorkspaceLayout
        leftSidebar={
          <ErrorBoundary variant="inline" componentName="LeftSidebar">
            <LeftSidebar />
          </ErrorBoundary>
        }
        mainContent={
          <WrapView {...wrapParams}>
            <ErrorBoundary variant="inline" componentName="ModalRenderer">
              <ModalRenderer />
            </ErrorBoundary>
            <ErrorBoundary variant="inline" componentName="WorkspaceView">
              <WorkspaceViewContent />
            </ErrorBoundary>
          </WrapView>
        }
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

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel } = useWorkspaceSlots();

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

  return (
    <div
      ref={dropRef}
      className={cn(
        'h-full min-h-0 overflow-hidden',
        isOver && 'ring-2 ring-inset ring-border-primary'
      )}
    >
      <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />
    </div>
  );
}
