import { FileText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { selectCurrentPr } from '@shared/pull-requests';
import { type Task } from '@shared/tasks';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { TaskContextMenu } from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import { runPreArchiveCommand } from '@renderer/features/tasks/run-pre-archive-command';
import { type TaskStore } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';

export type ReadyTask = TaskStore & { data: Task };

export const TaskRow = observer(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showArchiveWithNote = useShowModal('archiveTaskWithNoteModal');
  const showEditPreArchive = useShowModal('editPreArchiveCommandModal');
  const showConfirm = useShowModal('confirmActionModal');
  const taskManager = getTaskManagerStore(task.data.projectId);
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const preArchiveCommand = homeDraft?.preArchiveCommand ?? '';
  const [isArchiving, setIsArchiving] = useState(false);

  const handleArchive = (options?: { skipPreCommand?: boolean }) => {
    if (isArchiving) return;
    setIsArchiving(true);
    void (async () => {
      try {
        if (!options?.skipPreCommand) {
          await runPreArchiveCommand(task.data.projectId, task.data.id, preArchiveCommand);
        }
        await taskManager?.archiveTask(task.data.id);
      } finally {
        setIsArchiving(false);
      }
    })();
  };
  const handleArchiveWithNote = () =>
    showArchiveWithNote({
      projectId: task.data.projectId,
      taskId: task.data.id,
      taskName: task.data.name,
    });
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleDelete = () =>
    showConfirm({
      title: t('sidebar.deleteTask.title'),
      description: t('sidebar.deleteTask.description', { name: task.data.name }),
      confirmLabel: t('common.delete'),
      onSuccess: () => void taskManager?.deleteTask(task.data.id),
    });
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });

  const isArchived = Boolean(task.data.archivedAt);
  const handleOpenDetails = () => {
    if (isArchived) return;
    handleProvision();
    navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
  };
  const canPin = task.state !== 'unregistered';
  const agentAttention = taskAgentStatus(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const branchName = asProvisioned(task)?.workspace.git.branchName ?? task.data.taskBranch;

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={isArchived}
      needsReview={task.data.needsReview}
      canMarkReview={task.state !== 'unregistered'}
      branchName={branchName}
      openDetailsLabel={t('sidebar.openTaskDetails')}
      onOpenDetails={isArchived ? undefined : handleOpenDetails}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onMarkNeedsReview={() => void task.setNeedsReview(true)}
      onUnmarkNeedsReview={() => void task.setNeedsReview(false)}
      onRename={handleRename}
      onArchive={() => handleArchive()}
      onArchiveSkipPreCommand={
        preArchiveCommand.trim() ? () => handleArchive({ skipPreCommand: true }) : undefined
      }
      onArchiveWithNote={handleArchiveWithNote}
      onConfigurePreArchive={() => showEditPreArchive({})}
      onRestore={handleRestore}
      onDelete={handleDelete}
    >
      <button
        onClick={handleOpenDetails}
        className="group flex items-center gap-2 rounded-lg p-3  hover:bg-background-1 transition-colors w-full"
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
        <div className="flex items-center shrink-0 [&>span]:ring-2 [&>span]:ring-background [&>span:not(:first-child)]:-ml-1.5">
          {Object.entries(task.conversationStats).map(([providerId, count]) => {
            const config = agentConfig[providerId as keyof typeof agentConfig];
            if (!config) return null;
            return (
              <span
                key={providerId}
                className="relative flex items-center justify-center h-5 w-5 rounded-sm bg-background-2 overflow-hidden"
                title={`${config.name}: ${String(count)}`}
              >
                <AgentLogo
                  logo={config.logo}
                  alt={config.alt}
                  isSvg={config.isSvg}
                  invertInDark={config.invertInDark}
                  className="h-3.5 w-3.5"
                />
                {count > 1 && (
                  <span className="absolute -bottom-px -right-px text-[8px] leading-none font-semibold bg-background text-foreground-passive px-px rounded-tl">
                    {count}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <div
          className={cn(
            'flex min-w-8 shrink-0 items-center justify-end',
            agentAttention ? 'justify-end' : 'justify-middle'
          )}
        >
          {agentAttention ? (
            <AgentStatusIndicator status={agentAttention} />
          ) : (
            <RelativeTime
              value={task.data.createdAt}
              className="text-xs text-foreground-passive font-mono pr-1"
              compact
            />
          )}
        </div>
      </button>
    </TaskContextMenu>
  );
});
