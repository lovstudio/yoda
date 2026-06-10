import { Archive, Loader2, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
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
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');

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
  const { archiveTask } = useArchiveTask(projectId);
  // Driven by the store so any archive entry point (sidebar, tabs, modal)
  // shows the same loading state while the archive flow is in flight.
  const isArchiving = taskManager?.archivingTaskIds.has(taskId) ?? false;

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));
  const isAgentWorking = taskAgentStatus(task) === 'working';

  const taskName = task.data.name;
  const taskIndentClass = rowVariant === 'underProject' ? 'pl-8' : 'pl-2';

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

  const handleArchiveWithNote = () => {
    showArchiveWithNote({
      projectId,
      taskId,
      taskName,
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
  };

  return (
    <TaskContextMenu {...menuActions}>
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 h-8 gap-1',
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
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              (isBootstrapping || isArchiving) && 'text-foreground/40'
            )}
          >
            {taskName}
          </span>
          {rowVariant === 'flat' && (
            <span className="shrink-0 truncate max-w-[8rem] rounded-sm bg-background-tertiary-2 px-1 text-[10px] uppercase tracking-wide text-foreground-tertiary">
              {projectName}
            </span>
          )}
          <RenderPrBadge task={task} />
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
