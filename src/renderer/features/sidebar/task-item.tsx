import { Archive, ChevronRight, GitBranch, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { selectCurrentPr } from '@shared/pull-requests';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
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
  taskDisplayStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { OVERVIEW_TAB_ID } from '@renderer/features/tasks/tabs/tab-manager-store';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { appState, sidebarStore } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { branchColor } from '@renderer/utils/branch-color';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';
import { useAltKeyHeld } from './use-alt-key-held';

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
}

/** Indent per subtask level; depth is visually capped so deep trees stay readable. */
const TASK_TREE_INDENT_PX = 14;
const TASK_TREE_MAX_VISUAL_DEPTH = 5;

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
  depth = 0,
  childCount = 0,
  treeTrail,
}: SidebarTaskItemProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  const { params } = useParams('task');
  // The selected task stays highlighted even after navigating to a non-task view
  // (settings, skills, etc.) — selection is only cancelled by switching to another
  // task, not by leaving the task view. `viewParamsStore['task']` persists the
  // last-active task across view changes, so we match against it regardless of the
  // current view.
  const isActive = params.taskId === taskId && params.projectId === projectId;
  const [isMenuOpen, setMenuOpen] = useState(false);
  // The sidebar archive button is a two-step confirm: the first click arms it
  // (turns it into a confirm badge), the second click archives. Anything that
  // moves focus away — leaving the row, opening the menu — disarms it.
  const [isArchiveConfirming, setArchiveConfirming] = useState(false);
  // Alt/Option-held hover hints (and click) that the row pins into the global
  // side pane instead of navigating — same affordance as the nav controls.
  const altHeld = useAltKeyHeld();
  const [isHovered, setHovered] = useState(false);

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
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
  const hasAgentNotification = taskDisplayStatus(task) !== null;

  const taskName = task.data.name;
  const treeDepth = rowVariant === 'underProject' ? Math.min(depth, TASK_TREE_MAX_VISUAL_DEPTH) : 0;
  // One guide slot per (visually capped) tree level. Without trail data (drag
  // ghost previewing a projected depth) fall back to a bare elbow.
  const guideTrail =
    treeDepth > 0
      ? (treeTrail?.slice(-treeDepth) ?? Array.from({ length: treeDepth }, () => false))
      : [];
  const hasChildren = rowVariant === 'underProject' && childCount > 0;
  const isCollapsed = hasChildren && sidebarStore.collapsedTaskIds.has(taskId);
  // Root-level parents swap pl-8 for a project-style mini-button slot (same 32px
  // name offset), so the hover-only chevron aligns with the project row's chevron
  // column instead of pushing the name right.
  const hasRootToggle = hasChildren && treeDepth === 0;
  const branchDisplay = sidebarStore.taskBranchDisplay;
  const taskIndentClass =
    rowVariant === 'underProject' ? (hasRootToggle ? undefined : 'pl-8') : 'pl-2';

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
    handleProvision();
    openPreferredConversationIfEmpty();
    navigate('task', { projectId, taskId });
  };

  // Alt/Option-click pins the task into the global side pane and behaves like a
  // normal open — it lands on the preferred session rather than the overview.
  // Provisioning is async, so resolve the pinned tab only once the task is
  // ready; a session-less task falls back to its overview.
  const pinTaskToSidePane = () => {
    void (async () => {
      if (task.state === 'unprovisioned' && task.phase === 'idle') {
        await taskManager?.provisionTask(taskId);
      }
      const provisioned = asProvisioned(getTaskStore(projectId, taskId));
      const tabId =
        provisioned?.taskView.tabManager.openPreferredConversationInShellPin() ?? OVERVIEW_TAB_ID;
      appState.sidePane.pinTask(projectId, taskId, tabId);
    })();
  };

  return (
    <TaskContextMenu
      {...menuActions}
      // Hold the deferred reflow while the menu is open: the menu is a portal,
      // so the pointer leaving the list onto it would otherwise release the
      // pointer-based hold and let "标记未读" reorder rows mid-interaction.
      onOpenChange={(open) =>
        open
          ? sidebarStore.holdTaskReflow('task-menu')
          : sidebarStore.releaseTaskReflow('task-menu')
      }
    >
      <Tooltip open={altHeld && isHovered}>
        <TooltipTrigger
          render={
            <SidebarMenuRow
              className={cn(
                // Two-line row: task name on top, branch below. Height is intrinsic
                // (min-h-8 keeps branch-less rows at the original 32px). `relative`
                // anchors the compact branch gutter inside the pl-8 icon column.
                'group/row relative flex items-center justify-between px-1 h-auto min-h-8 py-1 gap-1',
                taskIndentClass
              )}
              isActive={isActive}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => {
                setHovered(false);
                setArchiveConfirming(false);
              }}
              onClick={(e) => {
                setArchiveConfirming(false);
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
                  <SidebarItemMiniButton
                    type="button"
                    aria-label={t('sidebar.toggleSubtasks')}
                    aria-expanded={!isCollapsed}
                    className="shrink-0 transition-opacity duration-150 opacity-0 group-hover/row:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      sidebarStore.toggleTaskCollapsed(taskId);
                    }}
                  >
                    <ChevronRight
                      className={cn('h-4 w-4 transition-transform', !isCollapsed && 'rotate-90')}
                    />
                  </SidebarItemMiniButton>
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
                            <button
                              type="button"
                              aria-label={t('sidebar.toggleSubtasks')}
                              aria-expanded={!isCollapsed}
                              className="absolute inset-0 flex items-center justify-center rounded-sm text-foreground-tertiary opacity-0 transition-opacity duration-150 hover:bg-background-tertiary-2 hover:text-foreground group-hover/row:opacity-100"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                sidebarStore.toggleTaskCollapsed(taskId);
                              }}
                            >
                              <ChevronRight
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  !isCollapsed && 'rotate-90'
                                )}
                              />
                            </button>
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
                <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className={cn(
                        'min-w-0 truncate text-left transition-colors',
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
                  isMenuOpen || isArchiving || isArchiveConfirming
                    ? 'flex'
                    : hasAgentNotification
                      ? 'hidden'
                      : 'hidden group-hover/row:flex'
                )}
              >
                {isArchiveConfirming ? (
                  <Badge
                    render={
                      <button
                        type="button"
                        aria-label={t('sidebar.confirmArchive')}
                        disabled={isArchiving}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchiveConfirming(false);
                          // Quick archive defaults to NO pre-archive skill — the skill
                          // flow lives in the right-click menu's archive submenu.
                          menuActions.onArchiveQuick();
                        }}
                      />
                    }
                    className="h-6 cursor-pointer bg-destructive px-2.5 text-[11px] font-semibold uppercase tracking-wide text-destructive-foreground shadow-sm hover:bg-destructive/90"
                  >
                    {t('sidebar.confirmArchive')}
                  </Badge>
                ) : (
                  <>
                    <TaskActionsMenu
                      {...menuActions}
                      open={isMenuOpen}
                      onOpenChange={(open) => {
                        if (open) setArchiveConfirming(false);
                        setMenuOpen(open);
                      }}
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
                    <SidebarItemMiniButton
                      type="button"
                      aria-label={t('sidebar.archiveTask')}
                      disabled={isArchiving}
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiveConfirming(true);
                      }}
                    >
                      {isArchiving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Archive className="h-4 w-4" />
                      )}
                    </SidebarItemMiniButton>
                  </>
                )}
              </div>
              <div
                className={cn(
                  'items-center',
                  isMenuOpen || isArchiving || isArchiveConfirming
                    ? 'hidden'
                    : hasAgentNotification
                      ? 'flex'
                      : 'flex group-hover/row:hidden'
                )}
              >
                <TaskSidebarAgentStatus task={task} needsReview={needsReview} />
              </div>
            </SidebarMenuRow>
          }
        />
        <TooltipContent side="right">{t('appTabs.openInGlobalSidePane')}</TooltipContent>
      </Tooltip>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  if (!('prs' in task.data)) return null;
  const pr = selectCurrentPr(task.data.prs);
  return pr ? <PrBadge variant="compact" pr={pr} /> : null;
});

/**
 * One indent slot of the terminal-style tree guide. Non-elbow slots draw a
 * full-height vertical line while that ancestor still has siblings below
 * (│); the elbow slot draws the connector to this row (├ when `continues`,
 * └ when it is the last sibling).
 */
function TreeGuideSlot({
  continues,
  isElbow,
  fadeOnRowHover,
  children,
}: {
  continues: boolean;
  isElbow: boolean;
  /** Fade the guide lines out on row hover (slot doubles as a collapse toggle). */
  fadeOnRowHover?: boolean;
  children?: ReactNode;
}) {
  return (
    <span className="relative h-full shrink-0" style={{ width: TASK_TREE_INDENT_PX }}>
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 transition-opacity duration-150',
          fadeOnRowHover && 'group-hover/row:opacity-0'
        )}
      >
        {isElbow ? (
          <>
            <span className="absolute left-[5px] top-0 h-1/2 w-px bg-border" />
            <span className="absolute left-[5px] top-1/2 h-px w-1.5 bg-border" />
            {continues && <span className="absolute bottom-0 left-[5px] top-1/2 w-px bg-border" />}
          </>
        ) : (
          continues && <span className="absolute bottom-0 left-[5px] top-0 w-px bg-border" />
        )}
      </span>
      {children}
    </span>
  );
}
