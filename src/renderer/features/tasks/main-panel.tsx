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
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useEditorContext } from './editor/editor-provider';
import { MarkdownEditorPanel } from './editor/markdown-editor-panel';
import { useIsActiveTask } from './hooks/use-is-active-task';
import { TaskTabStrip } from './tabs/task-tab-strip';
import { TerminalsPanel } from './terminals/terminal-panel';
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

const SIDEBAR_COLLAPSED_SIZE = '0px';

const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel() {
  const { taskView } = useProvisionedTask();
  const sidebarPanelRef = usePanelRef();
  const [isHandleDragging, setIsHandleDragging] = useState(false);
  const layout = usePersistentPanelLayout('task-sidebar-layout');

  useEffect(() => {
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    const isCollapsed = panel.isCollapsed();
    if (taskView.isSidebarCollapsed && !isCollapsed) {
      panel.collapse();
    } else if (!taskView.isSidebarCollapsed && isCollapsed) {
      panel.expand();
    }
  }, [taskView.isSidebarCollapsed, sidebarPanelRef]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
      {...layout}
    >
      <ResizablePanel
        id="task-main-area"
        className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
        data-yoda-animate={isHandleDragging ? 'false' : 'true'}
      >
        <TaskMainColumn />
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={() => setIsHandleDragging(true)}
        onPointerUp={() => setIsHandleDragging(false)}
        onPointerCancel={() => setIsHandleDragging(false)}
      />
      <ResizablePanel
        id="task-sidebar"
        panelRef={sidebarPanelRef}
        defaultSize="25%"
        minSize="280px"
        maxSize="50%"
        collapsible
        collapsedSize={SIDEBAR_COLLAPSED_SIZE}
        className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
        data-yoda-animate={isHandleDragging ? 'false' : 'true'}
        onResize={() => {
          const wantCollapsed = sidebarPanelRef.current?.isCollapsed() ?? false;
          if (taskView.isSidebarCollapsed !== wantCollapsed) {
            taskView.setSidebarCollapsed(wantCollapsed);
          }
        }}
      >
        <TaskSidebar />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

const TaskMainColumn = observer(function TaskMainColumn() {
  const { taskView } = useProvisionedTask();
  const bottomPanelRef = usePanelRef();
  const draggingRef = useRef(false);
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
        <UnifiedMainContent />
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setIsHandleDragging(true);
          if (!draggingRef.current) {
            draggingRef.current = true;
            panelDragStore.setDragging(true);
          }
        }}
        onPointerUp={() => {
          setIsHandleDragging(false);
          if (draggingRef.current) {
            draggingRef.current = false;
            panelDragStore.setDragging(false);
          }
        }}
        onPointerCancel={() => {
          setIsHandleDragging(false);
          if (draggingRef.current) {
            draggingRef.current = false;
            panelDragStore.setDragging(false);
          }
        }}
        className={taskView.isTerminalDrawerOpen ? 'flex' : 'hidden'}
      />
      <ResizablePanel
        id="task-terminal-drawer"
        panelRef={bottomPanelRef}
        collapsible
        collapsedSize="0%"
        defaultSize="25%"
        minSize="15%"
        className="min-h-0 min-w-0 overflow-hidden bg-background text-foreground"
        data-yoda-animate={isHandleDragging ? 'false' : 'true'}
        onResize={() => {
          const wantOpen = !(bottomPanelRef.current?.isCollapsed() ?? false);
          if (taskView.isTerminalDrawerOpen !== wantOpen) {
            taskView.setTerminalDrawerOpen(wantOpen);
          }
        }}
      >
        <TerminalsPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});

const UnifiedMainContent = observer(function UnifiedMainContent() {
  const { taskId } = useTaskViewContext();
  const { taskView } = useProvisionedTask();
  const { setEditorHost, triggerLayout } = useEditorContext();
  const isActive = useIsActiveTask(taskId);

  const renderer = taskView.activeRenderer;
  useTabShortcuts(taskView.tabManager, {
    focused: isActive && taskView.focusedRegion === 'main',
  });

  // Re-run Monaco layout whenever the Monaco slot becomes visible so the editor
  // fills the host after transitioning from hidden to flex.
  useEffect(() => {
    if (renderer === 'monaco') triggerLayout();
  }, [renderer, triggerLayout]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
      onFocus={() => taskView.setFocusedRegion('main')}
      onPointerDown={() => taskView.setFocusedRegion('main')}
    >
      <TaskTabStrip />
      <div className="relative min-h-0 flex-1">
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
        {/* SVG source toggle — floats over the Monaco host when editing an SVG file */}
        {renderer === 'monaco' && <SvgSourceToggleOverlay />}

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
    </div>
  );
});

/**
 * Shown over the Monaco host when the active tab is an SVG file in source mode.
 * Lets the user toggle back to the SVG preview renderer.
 */
const SvgSourceToggleOverlay = observer(function SvgSourceToggleOverlay() {
  const { t } = useTranslation();
  const { taskView } = useProvisionedTask();
  const { tabManager } = taskView;
  const activeTab = tabManager.activeFileEntry;

  if (!activeTab || activeTab.renderer.kind !== 'svg-source') return null;

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
    </ToggleGroup>
  );
});
