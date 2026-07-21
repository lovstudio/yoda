import { FileText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { selectCurrentPr } from '@shared/pull-requests';
import { type Task } from '@shared/tasks';
import {
  TaskIssueLinkPopover,
  TaskLinkedIssues,
  type TaskIssueLinkingState,
} from '@renderer/features/projects/components/issues-view/task-issue-links';
import { TaskContextMenu } from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import { TaskSessionStatusControl } from '@renderer/features/tasks/components/task-session-status-control';
import { useTaskMenuActions } from '@renderer/features/tasks/components/use-task-menu-actions';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  taskSessionStatusSummary,
} from '@renderer/features/tasks/stores/task-selectors';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
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
  const taskManager = getTaskManagerStore(task.data.projectId);
  // Shared task-entity menu wiring (same items as every other task surface).
  const menuActions = useTaskMenuActions(task.data.projectId, task.data.id);

  const isArchived = Boolean(task.data.archivedAt);
  const sessionStatus = taskSessionStatusSummary(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const provisionedTask = asProvisioned(task);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);

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

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenDetails();
  };

  if (!menuActions) return null;

  return (
    <TaskContextMenu {...menuActions}>
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
            sessionStatus.primaryStatus ? 'justify-end' : 'justify-middle'
          )}
        >
          {sessionStatus.primaryStatus ? (
            <TaskSessionStatusControl task={task} />
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
