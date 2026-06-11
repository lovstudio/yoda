import { Archive, ChevronRight, GitBranch, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import { INTERNAL_PROJECT_ID } from '@shared/projects';
import { selectCurrentPr } from '@shared/pull-requests';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TaskSidebarAgentStatus } from '@renderer/features/sidebar/task-sidebar-agent-status';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import {
  copyTaskLink,
  TaskActionsMenu,
  TaskContextMenu,
} from '@renderer/features/tasks/components/task-context-menu';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  selectPreferredConversation,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { OVERVIEW_TAB_ID } from '@renderer/features/tasks/tabs/tab-manager-store';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { PrBadge } from '../../lib/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

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
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showCreateSubtask = useShowModal('newSubtaskModal');
  const showSetParent = useShowModal('setParentTaskModal');

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

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
  const { archiveTask, hasPreArchiveCommand } = useArchiveTask(projectId);
  // Driven by the store so any archive entry point (sidebar, tabs, modal)
  // shows the same loading state while the archive flow is in flight.
  const isArchiving = taskManager?.archivingTaskIds.has(taskId) ?? false;

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));
  const isAgentWorking = taskAgentStatus(task) === 'working';

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
  const taskIndentClass =
    rowVariant === 'underProject' ? (hasRootToggle ? undefined : 'pl-8') : 'pl-2';

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    void taskManager?.provisionTask(taskId);
  };

  // Archiving a task archives all of its conversations first, running the
  // pre-archive command against each live session by default.
  const handleArchive = (options?: { skipPreCommand?: boolean }) => {
    if (isArchiving) return;
    void archiveTask(taskId, options).catch((error: unknown) => {
      log.warn('SidebarTaskItem: archive task failed', { projectId, taskId, error });
    });
  };

  // Direct archive from the menu: note dialog, no pre-archive skill.
  const handleArchiveWithNote = () => {
    showArchiveWithNote({
      projectId,
      taskId,
      taskName,
      skipPreCommand: true,
    });
  };

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const canPin = task.state !== 'unregistered';
  const canMarkReview = task.state !== 'unregistered';
  const canAssignWorkspace = projectId === INTERNAL_PROJECT_ID || task.data.isPinned;
  const needsReview = task.data.needsReview;

  const provisionedTask = asProvisioned(task);
  const branchName =
    provisionedTask?.workspace.git.branchName ??
    ('taskBranch' in task.data ? task.data.taskBranch : undefined);
  const branchDisplay = sidebarStore.taskBranchDisplay;
  // Generated branches end in a 5-char random suffix (createTask:
  // Math.random().toString(36).slice(2, 7)). The slug before it mirrors the
  // task name shown right next to it, so compact mode renders only that
  // suffix — the one part that distinguishes the branch. Non-generated
  // branches (Linear, custom) fall back to their basename.
  const compactBranchName = branchName
    ? (/-([0-9a-z]{5})$/.exec(branchName)?.[1] ?? branchName.slice(branchName.lastIndexOf('/') + 1))
    : undefined;
  const workspace = provisionedTask?.workspace;
  const handleReconnect =
    workspace?.connectionState != null ? () => workspace.reconnect() : undefined;

  const project = getProjectStore(projectId);
  const projectName =
    project?.state === 'unregistered' ? projectId : (project?.displayName ?? projectId);
  const projectPath = project?.data?.path;

  const menuConversation = getTaskMenuConversation(provisionedTask);
  const sessionInfoCwd = provisionedTask?.path ?? projectPath;
  const sessionFields = menuConversation
    ? buildTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : {};
  const hasStoredConversations = Object.values(task.conversationStats).some((count) => count > 0);
  const resolveSessionInfo = menuConversation
    ? () => resolveTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : hasStoredConversations && task.state !== 'unregistered'
      ? async () => {
          const conversations = await rpc.conversations.getConversationsForTask(projectId, taskId);
          const conversation = selectPreferredConversation(conversations);
          return conversation
            ? resolveTaskMenuSessionFields(conversation, sessionInfoCwd)
            : undefined;
        }
      : undefined;

  const handleCopyYodaLink = () => {
    const link = buildTaskDeepLink({
      projectId,
      taskId,
    });
    void copyTaskLink(link, t);
  };
  const handleRestartSession =
    provisionedTask && menuConversation
      ? (tmuxOverride?: boolean) =>
          void provisionedTask.conversations.restartConversation(
            menuConversation.id,
            undefined,
            tmuxOverride
          )
      : undefined;

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

  // The context-menu "open details" entry enters the task and activates its
  // fixed Overview tab (task info / sessions / sub-tasks), distinguishing it from
  // a plain row click which only enters the task view on the last-active tab.
  const handleOpenOverview = () => {
    handleProvision();
    navigate('task', { projectId, taskId });
    asProvisioned(task)?.taskView.tabManager.setActiveTab(OVERVIEW_TAB_ID);
  };

  const menuActions = {
    projectId,
    projectName,
    taskId,
    taskName,
    isPinned: task.data.isPinned,
    canPin,
    isArchived: false,
    needsReview,
    canMarkReview,
    branchName,
    ...sessionFields,
    resolveSessionInfo,
    projectPath,
    workingDirectory: provisionedTask?.path,
    openDetailsLabel: t('tasks.context.openDetails'),
    onOpenDetails: handleOpenOverview,
    onPin: () => void task.setPinned(true),
    onUnpin: () => void task.setPinned(false),
    onMarkNeedsReview: () => void task.setNeedsReview(true),
    onUnmarkNeedsReview: () => void task.setNeedsReview(false),
    onRename: handleRename,
    onArchive: handleArchiveWithNote,
    onArchiveWithSkill: () => handleArchive(),
    hasArchiveSkill: hasPreArchiveCommand,
    onConfigureArchiveSkill: () => navigate('settings', { tab: 'tasks' }),
    onCopyYodaLink: handleCopyYodaLink,
    onReconnect: handleReconnect,
    onRestartSession: handleRestartSession,
    // Projectless Drafts tasks belong directly to a workspace, and pinned tasks
    // appear standalone in the workspace-scoped pinned strip — both can be moved
    // individually. Other project-bound tasks follow their project's workspace.
    currentWorkspaceId: canAssignWorkspace
      ? (registeredTaskData(task)?.sidebarWorkspaceId ??
        getProjectStore(projectId)?.data?.workspaceId ??
        null)
      : undefined,
    onAssignWorkspace: canAssignWorkspace
      ? (workspaceId: string | null) => void task.setSidebarWorkspaceId(workspaceId)
      : undefined,
    // Subtask tree entries — projectless Drafts tasks stay flat for now.
    onCreateSubtask:
      projectId !== INTERNAL_PROJECT_ID && task.state !== 'unregistered'
        ? () => showCreateSubtask({ projectId, parentTaskId: taskId })
        : undefined,
    onSetParent:
      projectId !== INTERNAL_PROJECT_ID && task.state !== 'unregistered'
        ? () => showSetParent({ projectId, taskId })
        : undefined,
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
        onMouseLeave={() => setArchiveConfirming(false)}
        onClick={() => {
          setArchiveConfirming(false);
          handleOpenDetails();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleRename();
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
          {branchDisplay === 'compact' &&
            (rowVariant === 'underProject' ? (
              // The suffix lives INSIDE the pl-8 icon column (same column as
              // the project rows' chevron/icon), absolutely positioned so the
              // label keeps its exact indent and stays aligned across rows.
              // Parent rows reuse that column for the hover collapse chevron —
              // the suffix fades out as the chevron fades in.
              compactBranchName && (
                <span
                  title={branchName}
                  className={cn(
                    'pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center overflow-hidden',
                    hasRootToggle && 'transition-opacity duration-150 group-hover/row:opacity-0',
                    (isBootstrapping || isArchiving) && 'opacity-40'
                  )}
                >
                  {/* 8px keeps 5 mono chars (~24px) comfortably inside the
                      32px column — at 9px the text nearly touched the row's
                      rounded background edge. */}
                  <span className="truncate font-mono text-[8px] tracking-tight text-foreground-tertiary-passive">
                    {compactBranchName}
                  </span>
                </span>
              )
            ) : (
              // Flat/pinned rows have no icon column — a fixed-width leading
              // gutter keeps their labels mutually aligned instead (kept empty
              // for branch-less rows so names don't drift).
              <span
                title={branchName}
                className={cn(
                  'shrink-0 w-[5ch] truncate font-mono text-[10px] text-foreground-tertiary-passive',
                  (isBootstrapping || isArchiving) && 'opacity-40'
                )}
              >
                {compactBranchName}
              </span>
            ))}
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
              : isAgentWorking
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
                    handleArchive();
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
              : isAgentWorking
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
