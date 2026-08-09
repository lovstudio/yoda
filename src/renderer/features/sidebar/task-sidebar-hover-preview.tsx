import { useQuery } from '@tanstack/react-query';
import { GitBranch, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { TaskLifecycleStatus } from '@shared/tasks';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { taskSessionStatusSummary } from '@renderer/features/tasks/stores/task-selectors';
import { taskDeliverySummariesQuery } from '@renderer/features/tasks/task-delivery-summaries-query';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';

const TASK_LIFECYCLE_LABELS: Record<TaskLifecycleStatus, string> = {
  todo: 'tasks.lifecycle.todo',
  in_progress: 'tasks.lifecycle.inProgress',
  review: 'tasks.lifecycle.review',
  done: 'tasks.lifecycle.done',
  cancelled: 'tasks.lifecycle.cancelled',
};

export const TaskSidebarHoverPreview = observer(function TaskSidebarHoverPreview({
  task,
  projectId,
  projectName,
  branchName,
  isOpen,
}: {
  task: TaskStore;
  projectId: string;
  projectName: string;
  branchName?: string;
  isOpen: boolean;
}) {
  const { t } = useTranslation();
  const { data: summaries, isLoading } = useQuery({
    ...taskDeliverySummariesQuery(projectId, task.data.id),
    enabled: isOpen,
  });
  const latestSummary = summaries?.find((summary) => summary.text.trim());
  const sessionStatus = taskSessionStatusSummary(task);
  const sessionCount = Math.max(
    Object.values(task.conversationStats).reduce((total, count) => total + count, 0),
    summaries?.length ?? 0
  );
  const lifecycleLabel = t(TASK_LIFECYCLE_LABELS[task.data.status]);
  const statusLabel = sessionStatus.primaryStatus
    ? t(`agentStatus.${sessionStatus.primaryStatus}`)
    : lifecycleLabel;

  return (
    <div
      data-sidebar-task-hover-preview
      className="flex w-full min-w-0 flex-col overflow-hidden text-foreground"
    >
      <div className="border-b border-border/70 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-5">{task.data.name}</div>
            <div className="mt-0.5 truncate text-xs text-foreground-tertiary-passive">
              {projectName}
            </div>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full bg-background-tertiary-2 px-2 py-0.5 text-[10px] leading-4 text-foreground-tertiary',
              sessionStatus.primaryStatus && 'text-foreground'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-1.5 rounded-full bg-foreground-tertiary-muted',
                sessionStatus.primaryStatus === 'working' && 'bg-foreground',
                sessionStatus.primaryStatus === 'error' && 'bg-foreground-destructive',
                sessionStatus.primaryStatus === 'awaiting-input' && 'bg-status-in-review'
              )}
            />
            {statusLabel}
          </span>
        </div>

        {branchName && (
          <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-tertiary-passive">
            <GitBranch className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-mono">{branchName}</span>
          </div>
        )}
      </div>

      <div className="min-w-0 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-foreground-tertiary-muted">
          <span>{t('tasks.sessionInfo.summaryLabel')}</span>
          {latestSummary?.timestamp && <RelativeTime value={latestSummary.timestamp} compact ago />}
        </div>
        <div className="max-h-48 min-w-0 overflow-y-auto overflow-x-hidden break-words [overflow-wrap:anywhere]">
          {isLoading ? (
            <div className="flex justify-center py-5">
              <Spinner size="sm" className="text-foreground-tertiary" />
            </div>
          ) : latestSummary ? (
            <MarkdownRenderer
              content={latestSummary.text}
              variant="compact"
              className="text-xs leading-5"
            />
          ) : (
            <div className="py-4 text-center text-xs text-foreground-tertiary-passive">
              {t('tasks.panel.noSummary')}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2 text-[11px] text-foreground-tertiary-passive">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MessageSquare className="size-3 shrink-0" />
          <span>{t('tasks.overview.sessions', { count: sessionCount })}</span>
        </span>
        {task.data.needsReview && (
          <span className="shrink-0 text-status-in-review">{t('sidebar.needsReview')}</span>
        )}
        {task.data.lastInteractedAt && (
          <RelativeTime
            value={task.data.lastInteractedAt}
            compact
            ago
            className="ml-auto shrink-0"
          />
        )}
      </div>
    </div>
  );
});
