import { FileText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buildTaskDeepLink } from '@shared/deep-links';
import { selectCurrentPr } from '@shared/pull-requests';
import { type Task } from '@shared/tasks';
import {
  TaskIssueLinkPopover,
  TaskLinkedIssues,
  type TaskIssueLinkingState,
} from '@renderer/features/projects/components/issues-view/task-issue-links';
import { useArchiveTask } from '@renderer/features/tasks/archive-task';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import {
  copyTaskLink,
  TaskContextMenu,
} from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import {
  buildTaskMenuSessionFields,
  getTaskMenuConversation,
  resolveTaskMenuSessionFields,
  selectPreferredConversation,
} from '@renderer/features/tasks/components/task-menu-session-info';
import { interruptTaskSessions } from '@renderer/features/tasks/interrupt-task-sessions';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { OVERVIEW_TAB_ID } from '@renderer/features/tasks/tabs/tab-manager-store';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';

export type ReadyTask = TaskStore & { data: Task };

export const TaskRow = observer(function TaskRow({
  task,
  isSelected,
  issueLinking,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  issueLinking: TaskIssueLinkingState;
  onToggleSelect: () => void;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const taskManager = getTaskManagerStore(task.data.projectId);
  const { archiveTask, hasPreArchiveCommand } = useArchiveTask(task.data.projectId);

  // Direct archive: dialog for an optional note, no pre-archive skill.
  const handleArchive = () =>
    showArchiveWithNote({
      projectId: task.data.projectId,
      taskId: task.data.id,
      taskName: task.data.name,
      skipPreCommand: true,
    });
  // Run the configured pre-archive skill against every live session, then archive.
  const handleArchiveWithSkill = () =>
    void archiveTask(task.data.id).catch((error: unknown) => {
      log.warn('TaskRow: archive task failed', { taskId: task.data.id, error });
    });
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });

  const isArchived = Boolean(task.data.archivedAt);
  const canPin = task.state !== 'unregistered';
  const agentAttention = taskAgentStatus(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const provisionedTask = asProvisioned(task);
  const branchName = provisionedTask?.workspace.git.branchName ?? task.data.taskBranch;
  const menuConversation = getTaskMenuConversation(provisionedTask);
  const sessionInfoCwd = provisionedTask?.path;
  const sessionFields = menuConversation
    ? buildTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : {};
  const hasStoredConversations = Object.values(task.conversationStats).some((count) => count > 0);
  const resolveSessionInfo = menuConversation
    ? () => resolveTaskMenuSessionFields(menuConversation, sessionInfoCwd)
    : hasStoredConversations && task.state !== 'unregistered'
      ? async () => {
          const conversations = await rpc.conversations.getConversationsForTask(
            task.data.projectId,
            task.data.id
          );
          const conversation = selectPreferredConversation(conversations);
          return conversation
            ? resolveTaskMenuSessionFields(conversation, sessionInfoCwd)
            : undefined;
        }
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
    if (isArchived) return;
    handleProvision();
    openPreferredConversationIfEmpty();
    navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
  };

  // Double-clicking an archived row restores it and opens the task, so an
  // archived task can be reactivated without going through the context menu.
  const handleRestoreAndOpen = () => {
    if (!isArchived) return;
    void (async () => {
      await taskManager?.restoreTask(task.data.id);
      await taskManager?.provisionTask(task.data.id);
      asProvisioned(task)?.taskView.tabManager.openPreferredConversation();
      navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
    })();
  };

  // The context-menu "open details" entry enters the task and activates its
  // fixed Overview tab (task info / sessions / sub-tasks), distinguishing it from
  // a plain row click which only enters the task view on the last-active tab.
  const handleOpenOverview = () => {
    if (isArchived) return;
    handleProvision();
    navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
    asProvisioned(task)?.taskView.tabManager.setActiveTab(OVERVIEW_TAB_ID);
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
  const handleCopyYodaLink = () => {
    const link = buildTaskDeepLink({
      projectId: task.data.projectId,
      taskId: task.data.id,
    });
    void copyTaskLink(link, t);
  };
  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenDetails();
  };

  return (
    <TaskContextMenu
      projectId={task.data.projectId}
      taskId={task.data.id}
      taskName={task.data.name}
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={isArchived}
      needsReview={task.data.needsReview}
      canMarkReview={task.state !== 'unregistered'}
      branchName={branchName}
      {...sessionFields}
      resolveSessionInfo={resolveSessionInfo}
      workingDirectory={provisionedTask?.path}
      openDetailsLabel={t('tasks.context.openDetails')}
      onOpenDetails={isArchived ? undefined : handleOpenOverview}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onMarkNeedsReview={() => void task.setNeedsReview(true)}
      onUnmarkNeedsReview={() => void task.setNeedsReview(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onArchiveWithSkill={handleArchiveWithSkill}
      hasArchiveSkill={hasPreArchiveCommand}
      onConfigureArchiveSkill={() => navigate('settings', { tab: 'tasks' })}
      onCopyYodaLink={handleCopyYodaLink}
      onRestore={handleRestore}
      onRestartSession={handleRestartSession}
    >
      <div
        role={isArchived ? undefined : 'button'}
        tabIndex={isArchived ? undefined : 0}
        onClick={handleOpenDetails}
        onDoubleClick={isArchived ? handleRestoreAndOpen : undefined}
        onKeyDown={isArchived ? undefined : handleRowKeyDown}
        className={cn(
          'group flex items-center gap-2 rounded-lg p-3 hover:bg-background-1 transition-colors w-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          isArchived ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={t('tasks.selectTask')}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 text-left text-sm truncate">{task.data.name}</span>
            <TaskGitDiffStats task={task} className="text-xs shrink-0" />
            {currentPr && <PrBadge pr={currentPr} />}
          </div>
          <TaskLinkedIssues task={task} className="min-w-0" />
          {task.data.archiveNote && (
            <div
              className="flex min-w-0 items-center gap-1 text-xs text-foreground-passive"
              title={task.data.archiveNote}
            >
              <FileText className="size-3 shrink-0" />
              <span className="min-w-0 truncate text-left italic">{task.data.archiveNote}</span>
            </div>
          )}
        </div>
        <div
          className="flex shrink-0 items-center opacity-70 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <TaskIssueLinkPopover task={task} issueLinking={issueLinking} />
        </div>
        <div
          className={cn(
            'flex min-w-8 shrink-0 items-center justify-end',
            agentAttention ? 'justify-end' : 'justify-middle'
          )}
        >
          {agentAttention ? (
            <AgentStatusIndicator
              status={agentAttention}
              onInterrupt={() => interruptTaskSessions(task.data.projectId, task.data.id)}
            />
          ) : (
            <RelativeTime
              value={task.data.createdAt}
              className="text-xs text-foreground-passive font-mono pr-1"
              compact
            />
          )}
        </div>
      </div>
    </TaskContextMenu>
  );
});
