import { Archive, Bookmark, GitBranch, ListPlus, MoreHorizontal, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectCurrentPr } from '@shared/pull-requests';
import {
  DEFAULT_TASK_APPEARANCE_SETTINGS,
  resolveTaskAppearance,
  type ResolvedTaskAppearance,
} from '@shared/task-appearance';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { TaskSidebarAgentStatus } from '@renderer/features/sidebar/task-sidebar-agent-status';
import {
  TaskActionsMenu,
  TaskContextMenu,
} from '@renderer/features/tasks/components/task-context-menu';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskSessionStatusSummary,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  taskIdleOpacityClassName,
  taskTitleStyleClassName,
} from '@renderer/features/tasks/task-appearance-classes';
import { TreeGuideSlot } from '@renderer/lib/components/tree-guide-slot';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { branchColor } from '@renderer/utils/branch-color';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';
import { TaskTreeToggleButton } from './task-tree-toggle-button';
import { useSidebarHoverIntent } from './use-sidebar-hover-intent';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /**
   * - `underProject` (default): nested under a project header, deeper indent.
   * - `pinned`: tight padding for the pinned strip.
   * - `flat`: top-level row in the no-grouping / type / activity views; shows the project tag.
   */
  rowVariant?: 'underProject' | 'pinned' | 'flat';
  /** Subtask tree depth (0 = root); only meaningful for `underProject`. */
  depth?: number;
  /** Direct subtask count; > 0 renders the collapse chevron. */
  childCount?: number;
  /** Terminal-tree guide state per indent slot — see SidebarRow.treeTrail. */
  treeTrail?: boolean[];
  /** True when this task is backed by an Agent Room / team workflow. */
  isMultiAgent?: boolean;
}

/** Subtask depth is visually capped so deep trees stay readable. */
const TASK_TREE_MAX_VISUAL_DEPTH = 5;

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
  depth = 0,
  childCount = 0,
  treeTrail,
  isMultiAgent = false,
}: SidebarTaskItemProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  const { params } = useParams('task');
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  // The selected task stays highlighted even after navigating to a non-task view
  // (settings, skills, etc.) — selection is only cancelled by switching to another
  // task, not by leaving the task view. `viewParamsStore['task']` persists the
  // last-active task across view changes, so we match against it regardless of the
  // current view.
  const isActive = params.taskId === taskId && params.projectId === projectId;
  const [isMenuOpen, setMenuOpen] = useState(false);
  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
  const preloadTaskView = useCallback(() => {
    void taskManager?.preloadTask(taskId);
  }, [taskManager, taskId]);
  const taskPreloadIntent = useSidebarHoverIntent(preloadTaskView);
  // Shared task-entity menu wiring (same items as every other task surface).
  const menuActions = useTaskMenuActions(projectId, taskId);
  // Driven by the store so any archive entry point (sidebar, tabs, modal)
  // shows the same loading state while the archive flow is in flight.
  const isArchiving = taskManager?.archivingTaskIds.has(taskId) ?? false;

  if (!menuActions) return null;

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));
  // Any displayed agent status pins the status slot: notifications are a
  // click target (jump to the pending session) and the working spinner keeps
  // its hover-to-interrupt affordance.
  const hasAgentNotification = taskSessionStatusSummary(task).primaryStatus !== null;
  const isIdle = !isBootstrapping && !hasAgentNotification;
  const appearance = resolveTaskAppearance(
    interfaceSettings?.taskAppearance ?? DEFAULT_TASK_APPEARANCE_SETTINGS,
    {
      isLongTerm: task.data.isLongTerm,
      needsReview: task.data.needsReview,
      isIdle,
      isMultiAgent,
    }
  );

  const taskName = task.data.name;
  const treeDepth = rowVariant === 'underProject' ? Math.min(depth, TASK_TREE_MAX_VISUAL_DEPTH) : 0;
  // One guide slot per (visually capped) tree level. Without trail data (drag
  // ghost previewing a projected depth) fall back to a bare elbow.
  const guideTrail =
    treeDepth > 0
      ? (treeTrail?.slice(-treeDepth) ?? Array.from({ length: treeDepth }, () => false))
      : [];
  const hasChildren = rowVariant === 'underProject' && childCount > 0;
  const isParentTask = childCount > 0;
  const canQuickCreateSubtask = isParentTask && Boolean(menuActions.onCreateSubtaskAndRun);
  const isCollapsed = hasChildren && sidebarStore.collapsedTaskIds.has(taskId);
  // Root-level parents swap pl-8 for a project-style mini-button slot (same 32px
  // name offset), so the hover-only chevron aligns with the project row's chevron
  // column instead of pushing the name right.
  const hasRootToggle = hasChildren && treeDepth === 0;
  const branchDisplay = sidebarStore.taskBranchDisplay;
  const taskIndentClass =
    rowVariant === 'underProject' ? (hasRootToggle ? undefined : 'pl-8') : 'pl-2';
  const markerLabel = t(
    isMultiAgent
      ? 'settings.taskAppearance.multiAgent'
      : task.data.isLongTerm
        ? 'settings.taskAppearance.longTerm'
        : 'settings.taskAppearance.standard'
  );
  const showMarkerInReservedSlot = appearance.marker !== 'none' && rowVariant === 'underProject';
  const showMarkerAtCompactEdge = appearance.marker !== 'none' && rowVariant !== 'underProject';

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  const needsReview = task.data.needsReview;

  const provisionedTask = asProvisioned(task);
  const branchName =
    provisionedTask?.workspace.git.branchName ??
    ('taskBranch' in task.data ? task.data.taskBranch : undefined);
  // Every create strategy except `no-worktree` gives the task its own branch
  // (and worktree) and sets taskBranch; in-place tasks leave it unset. So
  // taskBranch presence is exactly "this session is worktree-based" — the
  // compact rail shows only for those, tinted by a stable per-branch hue
  // (same branch → same color). In-place tasks get no rail.
  const taskBranch = 'taskBranch' in task.data ? task.data.taskBranch : undefined;
  const branchRailColor = taskBranch ? branchColor(taskBranch) : undefined;
  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);

  const openPreferredConversationIfEmpty = () => {
    if (!provisionedTask) return;
    const { taskView } = provisionedTask;
    if (taskView.tabManager.resolvedTabs.length > 0) return;
    if (taskView.tabManager.openPreferredConversation()) {
      taskView.setFocusedRegion('main');
    }
  };

  const handleOpenDetails = () => {
    const historyTabId = appState.history.lastTaskTab(projectId, taskId);
    const historyTarget = historyTabId
      ? provisionedTask?.taskView.tabManager.topLevelTargetForTabId(historyTabId)
      : undefined;
    if (historyTarget && appState.appTabs.openTaskScope(projectId, taskId, historyTarget)) return;

    handleProvision();
    openPreferredConversationIfEmpty();
    // A task without a live historical page is entering for the first time.
    // Keep its route target-less so provisioning can establish the initial tab.
    navigate('task', { projectId, taskId });
  };

  const handleToggleSubtasks = () => {
    if (!hasChildren) return;
    sidebarStore.toggleTaskCollapsed(taskId);
  };

  // Alt/Option-click pins the WHOLE task UI into the global side pane — opening
  // it there behaves exactly like routing to the task, just wrapped in the pane
  // (the self-contained pane auto-provisions and owns its own tab strip).
  const pinTaskToSidePane = () => {
    appState.sidePane.pinTaskView(projectId, taskId);
  };

  return (
    <TaskContextMenu
      {...menuActions}
      // Hold the deferred reflow while the menu is open: the menu is a portal,
      // so the pointer leaving the list onto it would otherwise release the
      // pointer-based hold and let "标记为未读" reorder rows mid-interaction.
      onOpenChange={(open) =>
        open
          ? sidebarStore.holdTaskReflow('task-menu')
          : sidebarStore.releaseTaskReflow('task-menu')
      }
    >
      <SidebarMenuRow
        className={cn(
          // Two-line row: task name on top, branch below. Height is intrinsic
          // (min-h-8 keeps branch-less rows at the original 32px). `relative`
          // anchors the compact branch gutter inside the pl-8 icon column.
          'group/row relative flex items-center justify-between px-1 h-auto min-h-8 py-1 gap-1 transition-[color,background-color,opacity]',
          taskIndentClass,
          taskIdleOpacityClassName(appearance.idleOpacity),
          appearance.idleOpacity < 100 &&
            'hover:opacity-100 focus-within:opacity-100 data-[active=true]:opacity-100'
        )}
        data-sidebar-entity="task"
        data-sidebar-project-id={projectId}
        data-sidebar-task-id={taskId}
        isActive={isActive}
        onPointerEnter={taskPreloadIntent.schedule}
        onPointerLeave={taskPreloadIntent.cancel}
        onMouseDown={(e) => {
          e.preventDefault();
          taskPreloadIntent.runNow();
        }}
        onClick={(e) => {
          // Alt/Option pins the task into the global side pane (landing
          // on its session, like a normal open); a plain click navigates.
          if (e.altKey) {
            pinTaskToSidePane();
            return;
          }
          handleOpenDetails();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          menuActions.onRename();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 self-stretch overflow-hidden">
          {hasRootToggle && (
            <TaskTreeToggleButton
              collapsed={isCollapsed}
              label={t('sidebar.toggleSubtasks')}
              variant="root"
              onToggle={handleToggleSubtasks}
            />
          )}
          {guideTrail.length > 0 && (
            <span className="flex shrink-0 self-stretch">
              {guideTrail.map((continues, index) => {
                const isElbow = index === guideTrail.length - 1;
                // Nested parents toggle via the elbow slot itself: guide lines
                // fade out on row hover and a chevron fades in, so the name
                // stays aligned with leaf siblings.
                const isToggleSlot = isElbow && hasChildren;
                return (
                  <TreeGuideSlot
                    key={index}
                    continues={continues}
                    isElbow={isElbow}
                    fadeOnRowHover={isToggleSlot}
                  >
                    {isToggleSlot && (
                      <TaskTreeToggleButton
                        collapsed={isCollapsed}
                        label={t('sidebar.toggleSubtasks')}
                        variant="nested"
                        onToggle={handleToggleSubtasks}
                      />
                    )}
                  </TreeGuideSlot>
                );
              })}
            </span>
          )}
          {branchDisplay === 'compact' && branchRailColor && (
            // Worktree-based sessions get a thin left rail; in-place tasks
            // don't. Its hue is stable per branch — identical branches share a
            // color, distinct branches differ.
            <span
              aria-hidden
              title={branchName}
              style={{ backgroundColor: branchRailColor }}
              className={cn(
                'absolute inset-y-1.5 left-0.5 w-[3px] rounded-full',
                (isBootstrapping || isArchiving) && 'opacity-40'
              )}
            />
          )}
          {showMarkerInReservedSlot && (
            <TaskAppearanceMarker
              marker={appearance.marker}
              label={markerLabel}
              className={cn(
                'absolute left-1 top-1/2 -translate-y-1/2',
                // The appearance marker and the root disclosure share the
                // reserved icon slot. Opacity alone does not remove the marker
                // from hit testing while it fades, so let pointer input reach
                // the disclosure button underneath.
                hasRootToggle && 'pointer-events-none transition-opacity group-hover/row:opacity-0'
              )}
            />
          )}
          {showMarkerAtCompactEdge && (
            <TaskAppearanceMarker
              compact
              marker={appearance.marker}
              label={markerLabel}
              className="absolute left-0 top-1/2 -translate-y-1/2"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
            <div className="flex min-w-0 items-center gap-1">
              <span
                className={cn(
                  'min-w-0 truncate text-left transition-colors',
                  taskTitleStyleClassName(appearance.titleStyle),
                  (isBootstrapping || isArchiving) && 'text-foreground/40'
                )}
              >
                {taskName}
              </span>
              {isCollapsed && (
                <span className="shrink-0 rounded-sm bg-background-tertiary-2 px-1 text-[10px] tabular-nums text-foreground-tertiary">
                  {childCount}
                </span>
              )}
              {rowVariant === 'flat' && (
                <span className="shrink-0 truncate max-w-[8rem] rounded-sm bg-background-tertiary-2 px-1 text-[10px] uppercase tracking-wide text-foreground-tertiary">
                  {projectName}
                </span>
              )}
              <RenderPrBadge task={task} />
            </div>
            {branchDisplay === 'full' && branchName && (
              <div
                className={cn(
                  'flex min-w-0 items-center gap-1 text-foreground-tertiary-passive',
                  (isBootstrapping || isArchiving) && 'opacity-40'
                )}
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="min-w-0 truncate font-mono text-[10px] leading-4">
                  {branchName}
                </span>
              </div>
            )}
          </div>
        </div>
        <div
          className={cn(
            'items-center gap-0.5',
            isMenuOpen || isArchiving
              ? 'flex'
              : hasAgentNotification
                ? 'hidden'
                : 'hidden group-hover/row:flex'
          )}
        >
          <TaskActionsMenu
            {...menuActions}
            open={isMenuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <SidebarItemMiniButton
                type="button"
                aria-label={t('sidebar.runScripts.menuLabel')}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </SidebarItemMiniButton>
            }
          />
          {canQuickCreateSubtask ? (
            <SidebarItemMiniButton
              type="button"
              aria-label={t('tasks.context.createSubtaskAndRun')}
              onClick={(e) => {
                e.stopPropagation();
                menuActions.onCreateSubtaskAndRun?.();
              }}
            >
              <ListPlus className="h-4 w-4" />
            </SidebarItemMiniButton>
          ) : (
            <SidebarItemMiniButton
              type="button"
              aria-label={t('sidebar.archiveTask')}
              disabled={isArchiving}
              onClick={(e) => {
                e.stopPropagation();
                // The sidebar icon archives immediately. The overflow menu
                // retains the optional-note and pre-archive-command flows.
                menuActions.onArchiveQuick();
              }}
            >
              <Archive className="h-4 w-4" />
            </SidebarItemMiniButton>
          )}
        </div>
        <div
          className={cn(
            'items-center',
            isMenuOpen || isArchiving
              ? 'hidden'
              : hasAgentNotification
                ? 'flex'
                : 'flex group-hover/row:hidden'
          )}
        >
          <TaskSidebarAgentStatus task={task} needsReview={needsReview} />
        </div>
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  const pr = selectCurrentPr(task.data.prs);
  return pr ? <PrBadge variant="compact" pr={pr} /> : null;
});

function TaskAppearanceMarker({
  marker,
  label,
  className,
  compact = false,
}: {
  marker: ResolvedTaskAppearance['marker'];
  label: string;
  className?: string;
  compact?: boolean;
}) {
  if (marker === 'none') return null;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        compact ? 'size-2' : 'size-6',
        marker === 'users' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground-tertiary',
        className
      )}
    >
      {marker === 'users' && <Users className={compact ? 'size-2' : 'size-4'} />}
      {marker === 'bookmark' && (
        <Bookmark className={cn('fill-current', compact ? 'size-2' : 'size-3.5')} />
      )}
      {marker === 'dot' && (
        <span
          aria-hidden
          className={cn('rounded-full bg-current', compact ? 'size-1' : 'size-1.5')}
        />
      )}
    </span>
  );
}

/**
 * One indent slot of the terminal-style tree guide. Non-elbow slots draw a
 * full-height vertical line while that ancestor still has siblings below
 * (│); the elbow slot draws the connector to this row (├ when `continues`,
 * └ when it is the last sibling).
 */
