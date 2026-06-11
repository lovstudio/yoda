import { Eye, Loader2, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePanelRef } from 'react-resizable-panels';
import {
  getTaskManagerStore,
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { usePersistentPanelLayout } from '@renderer/lib/hooks/use-persistent-panel-layout';
import { rpc } from '@renderer/lib/ipc';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { BottomPanel } from './bottom-panel';
import { FileActionsDropdown, FileActionsOverlay } from './components/file-actions';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useEditorContext } from './editor/editor-provider';
import { MarkdownEditorPanel } from './editor/markdown-editor-panel';
import { ActiveTaskTitlebar } from './task-titlebar';
import { OverviewPanel } from './view/overview-panel';
import { TaskSidebar } from './view/task-sidebar';

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind === 'creating' || kind === 'naming') {
    const setupRequiresBranchName = taskStore?.data.setupRequiresBranchName === true;
    const progressMessage =
      kind === 'naming'
        ? (taskStore?.provisionProgressMessage ??
          t(
            setupRequiresBranchName
              ? 'tasks.generatingTaskNameAndBranch'
              : 'tasks.generatingTaskName'
          ))
        : t('tasks.creatingTask');
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="text-xs font-mono text-foreground-muted">{progressMessage}</p>
      </div>
    );
  }

  if (kind === 'naming-error') {
    return <TaskSetupRecovery projectId={projectId} taskId={taskId} />;
  }

  if (kind === 'create-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-foreground-destructive">
            {t('tasks.errorCreatingTask')}
          </p>
          <p className="text-xs font-mono text-foreground-passive">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'project-mounting' || kind === 'provisioning') {
    const progressMessage = taskStore?.provisionProgressMessage ?? t('tasks.settingUpWorkspace');
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="text-xs font-mono text-foreground-muted">{progressMessage}</p>
      </div>
    );
  }

  if (kind === 'provision-error' || kind === 'project-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-foreground-destructive">
            {t('tasks.failedSetUpWorkspace')}
          </p>
          <p className="text-xs font-mono text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'idle' || kind === 'teardown') {
    const progressMessage = taskStore?.provisionProgressMessage ?? t('tasks.settingUpWorkspace');
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="text-xs font-mono text-foreground-muted">{progressMessage}</p>
      </div>
    );
  }

  if (kind === 'teardown-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-foreground-destructive">
            {t('tasks.failedTearDownWorkspace')}
          </p>
          <p className="text-xs font-mono text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'missing') {
    return null;
  }

  return <ReadyTaskMainPanel />;
});

const TaskSetupRecovery = observer(function TaskSetupRecovery({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const [manualBranchName, setManualBranchName] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const taskStore = getTaskStore(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);
  const errorMessage = taskErrorMessage(taskStore);
  const setupRequiresBranchName = taskStore?.data.setupRequiresBranchName === true;
  const setupStatus = taskStore?.data.setupStatus;
  const showManualBranchInput = setupRequiresBranchName;
  const title =
    setupStatus === 'branch_failed' ? t('tasks.branchSetupFailed') : t('tasks.namingFailed');

  const retry = (branch?: string) => {
    if (!taskManager || isRetrying) return;
    setIsRetrying(true);
    void taskManager.retryTaskSetup(taskId, branch).finally(() => setIsRetrying(false));
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-foreground-muted">{errorMessage}</p>
        {showManualBranchInput ? (
          <div className="flex w-full items-center gap-2">
            <Input
              value={manualBranchName}
              onChange={(e) => setManualBranchName(e.target.value)}
              placeholder={t('tasks.manualBranchPlaceholder')}
              disabled={isRetrying}
              className="h-8"
            />
            <Button
              size="sm"
              disabled={isRetrying || !manualBranchName.trim()}
              onClick={() => retry(manualBranchName.trim())}
            >
              {t('tasks.useBranch')}
            </Button>
          </div>
        ) : null}
        <Button size="sm" variant="outline" disabled={isRetrying} onClick={() => retry()}>
          {isRetrying
            ? t('common.loading')
            : t(showManualBranchInput ? 'tasks.retryTaskSetup' : 'tasks.retryNaming')}
        </Button>
      </div>
    </div>
  );
});

/**
 * Bottom-bar-first layout: the outer split is vertical so the terminal drawer
 * spans the full width (under the sidebar too); the main|sidebar horizontal
 * split only occupies the upper region.
 */
const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel() {
  const { taskView } = useProvisionedTask();
  const bottomPanelRef = usePanelRef();
  const [isHandleDragging, setIsHandleDragging] = useState(false);
  const layout = usePersistentPanelLayout('task-main-vertical');

  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    const isCollapsed = panel.isCollapsed();
    if (taskView.isTerminalDrawerOpen && isCollapsed) {
      panel.expand();
    } else if (!taskView.isTerminalDrawerOpen && !isCollapsed) {
      panel.collapse();
    }
  }, [taskView.isTerminalDrawerOpen, bottomPanelRef]);

  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      {...layout}
    >
      <ResizablePanel
        id="task-main-content"
        minSize="30%"
        className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
        data-yoda-animate={isHandleDragging ? 'false' : 'true'}
      >
        <TaskUpperSplit />
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsHandleDragging(true);
        }}
        onPointerUp={() => setIsHandleDragging(false)}
        onPointerCancel={() => setIsHandleDragging(false)}
        className={taskView.isTerminalDrawerOpen ? 'flex' : 'hidden'}
      />
      <ResizablePanel
        id="task-terminal-drawer"
        panelRef={bottomPanelRef}
        collapsible
        collapsedSize="0%"
        defaultSize="25%"
        minSize="15%"
        // Window-height changes must not rescale the drawer height.
        groupResizeBehavior="preserve-pixel-size"
        className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
        data-yoda-animate={isHandleDragging ? 'false' : 'true'}
        onResize={() => {
          const wantOpen = !(bottomPanelRef.current?.isCollapsed() ?? false);
          if (taskView.isTerminalDrawerOpen !== wantOpen) {
            taskView.setTerminalDrawerOpen(wantOpen);
          }
        }}
      >
        <BottomPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

const SIDEBAR_MIN_PX = 280;
const SIDEBAR_DEFAULT_PX = 360;
/** Dragging the divider below this width collapses the sidebar. */
const SIDEBAR_COLLAPSE_THRESHOLD_PX = 200;
const SIDEBAR_PX_VIEW_STATE_KEY = 'task-sidebar-px';

function loadSidebarPx(): number {
  const saved = viewStateCache.peek(SIDEBAR_PX_VIEW_STATE_KEY);
  const n = typeof saved === 'string' ? Number(saved) : NaN;
  return Number.isFinite(n) && n >= SIDEBAR_MIN_PX ? Math.round(n) : SIDEBAR_DEFAULT_PX;
}

/**
 * Upper region: (titlebar + main column) | task sidebar.
 *
 * Deliberately NOT a ResizablePanelGroup: the group model stores percentages,
 * so outer width changes (left workspace sidebar drag, window resize) leak
 * quantization wobble into sibling panels even with
 * groupResizeBehavior="preserve-pixel-size" (measured ±1-2px/frame plus
 * drift).  Plain flexbox with a px-width sidebar makes the invariant
 * structural: only this divider can change the sidebar width — the main
 * column absorbs every outer change.
 */
const TaskUpperSplit = observer(function TaskUpperSplit() {
  const { projectId, taskId } = useTaskViewContext();
  const { taskView } = useProvisionedTask();
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarElRef = useRef<HTMLDivElement>(null);
  const [sidebarPx, setSidebarPx] = useState(loadSidebarPx);
  const sidebarPxRef = useRef(sidebarPx);
  sidebarPxRef.current = sidebarPx;
  const dragRef = useRef<{ startX: number; startPx: number } | null>(null);

  const isCollapsed = taskView.isSidebarCollapsed;
  // Maximized: the sidebar overlays the whole upper split. The main column stays
  // mounted underneath so editor/Activity state survives the toggle.
  const isSidebarMaximized = taskView.isSidebarMaximized && !isCollapsed;

  const endDividerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Hand the width back to React + persistence only on release.
    setSidebarPx(sidebarPxRef.current);
    viewStateCache.set(SIDEBAR_PX_VIEW_STATE_KEY, String(sidebarPxRef.current));
    void rpc.viewState.save(SIDEBAR_PX_VIEW_STATE_KEY, String(sidebarPxRef.current));
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
    >
      <div
        data-task-main-column
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <ActiveTaskTitlebar projectId={projectId} taskId={taskId} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <TaskMainAreaSplit />
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="relative w-px shrink-0 cursor-col-resize bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startPx: isCollapsed ? 0 : sidebarPxRef.current };
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag) return;
          // Dragging left widens the sidebar.
          const raw = drag.startPx + (drag.startX - e.clientX);
          if (raw < SIDEBAR_COLLAPSE_THRESHOLD_PX) {
            if (!taskView.isSidebarCollapsed) taskView.setSidebarCollapsed(true);
            return;
          }
          if (taskView.isSidebarCollapsed) taskView.setSidebarCollapsed(false);
          const max = (containerRef.current?.getBoundingClientRect().width ?? Infinity) / 2;
          const px = Math.round(Math.min(Math.max(raw, SIDEBAR_MIN_PX), max));
          // Write the width straight to the DOM while dragging — zero-frame
          // lag, no React render on the pointer hot path. React state catches
          // up once on release (endDividerDrag).
          sidebarPxRef.current = px;
          if (sidebarElRef.current) {
            sidebarElRef.current.style.width = `min(${px}px, 50%)`;
          }
        }}
        onPointerUp={endDividerDrag}
        onPointerCancel={endDividerDrag}
      />
      <div
        ref={sidebarElRef}
        data-task-sidebar
        className={cn(
          'min-h-0 shrink-0 overflow-hidden bg-background text-foreground',
          isSidebarMaximized && 'absolute inset-0 z-20'
        )}
        // min() lets narrow windows clamp the sidebar via CSS without
        // touching the stored px — it springs back when space returns.
        style={
          isSidebarMaximized ? undefined : { width: isCollapsed ? 0 : `min(${sidebarPx}px, 50%)` }
        }
      >
        <TaskSidebar />
      </div>
    </div>
  );
});

const TaskMainAreaSplit = observer(function TaskMainAreaSplit() {
  return (
    <div className="h-full w-full min-h-0 min-w-0">
      <UnifiedMainContent />
    </div>
  );
});

const UnifiedMainContent = observer(function UnifiedMainContent() {
  const { taskView } = useProvisionedTask();

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
      onFocus={() => taskView.setFocusedRegion('main')}
      onPointerDown={() => taskView.setFocusedRegion('main')}
    >
      {/* Phase 2: tabs live in the top-level app strip (titlebar row). */}
      <TaskActiveTabContent />
    </div>
  );
});

export const TaskActiveTabContent = observer(function TaskActiveTabContent() {
  const { taskView } = useProvisionedTask();
  const { setEditorHost, triggerLayout } = useEditorContext();

  const renderer = taskView.activeRenderer;

  // Re-run Monaco layout whenever the Monaco slot becomes visible so the editor
  // fills the host after transitioning from hidden to flex.
  useEffect(() => {
    if (renderer === 'monaco') triggerLayout();
  }, [renderer, triggerLayout]);

  return (
    <div className="relative h-full min-h-0 flex-1" data-task-active-tab-content>
      {/*
       * Persistent Monaco host — always in the DOM, never inside an Activity.
       * CSS display controls visibility so Monaco is never measured at 0×0.
       * triggerLayout() is called above whenever this transitions to visible.
       */}
      <div
        ref={setEditorHost}
        className="absolute inset-0"
        style={{ display: renderer === 'monaco' ? 'flex' : 'none' }}
      />
      {/* Floating toolbar over the Monaco host — preview toggle for SVG source,
          file actions for every code file (mirrors the markdown preview). */}
      {renderer === 'monaco' && <MonacoFileToolbar />}

      <Activity mode={renderer === 'overview' ? 'visible' : 'hidden'}>
        <OverviewPanel />
      </Activity>
      <Activity mode={renderer === 'markdown' ? 'visible' : 'hidden'}>
        <MarkdownEditorPanel />
      </Activity>
      <Activity mode={renderer === 'diff' ? 'visible' : 'hidden'}>
        <DiffView />
      </Activity>
      <Activity mode={renderer === 'agents' ? 'visible' : 'hidden'}>
        <ConversationsPanel />
      </Activity>
      <Activity mode={renderer === 'other-file' ? 'visible' : 'hidden'}>
        <EditorMainPanel />
      </Activity>
    </div>
  );
});

/**
 * Floats over the Monaco host: SVG source files get a preview/source toggle,
 * every code file gets the file-actions dropdown — same top-right chrome as
 * the markdown preview.
 */
const MonacoFileToolbar = observer(function MonacoFileToolbar() {
  const { taskView } = useProvisionedTask();
  const activeTab = taskView.tabManager.activeFileEntry;

  if (!activeTab) return null;
  if (activeTab.renderer.kind === 'svg-source') return <SvgSourceToggleOverlay />;
  return <FileActionsOverlay filePath={activeTab.path} />;
});

/**
 * Shown over the Monaco host when the active tab is an SVG file in source mode.
 * Lets the user toggle back to the SVG preview renderer.
 */
const SvgSourceToggleOverlay = observer(function SvgSourceToggleOverlay() {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const activeTab = tabManager.activeFileEntry;

  if (!activeTab || activeTab.renderer.kind !== 'svg-source') return null;
  const sourcePath = `${provisioned.path.replace(/\/+$/, '')}/${activeTab.path}`;

  return (
    <ToggleGroup
      value={['svg-source']}
      onValueChange={(value) => {
        if (value.includes('svg')) {
          tabManager.updateRenderer(activeTab.path, () => ({ kind: 'svg' }));
        }
      }}
      size="sm"
      className="absolute right-3 top-3 z-10"
    >
      <ToggleGroupItem value="svg" aria-label={t('editor.viewRendered')}>
        <Eye className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <ToggleGroupItem value="svg-source" aria-label={t('editor.editSource')}>
        <Pencil className="h-3.5 w-3.5" />
      </ToggleGroupItem>
      <FileActionsDropdown
        sourcePath={sourcePath}
        className="flex h-full w-auto items-center justify-center rounded-none border-l border-border px-2"
      />
    </ToggleGroup>
  );
});
