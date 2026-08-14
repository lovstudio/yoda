import { useQuery } from '@tanstack/react-query';
import { Cpu, GitBranch, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { TaskLifecycleStatus } from '@shared/tasks';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import {
  taskSessionStatusSummary,
  type TaskSessionVisibleStatus,
} from '@renderer/features/tasks/stores/task-selectors';
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

const TASK_LIFECYCLE_DOT_CLASSES: Record<TaskLifecycleStatus, string> = {
  todo: 'bg-status-todo',
  in_progress: 'bg-status-in-progress',
  review: 'bg-status-in-review',
  done: 'bg-status-done',
  cancelled: 'bg-status-cancelled',
};

const TASK_SESSION_DOT_CLASSES: Record<TaskSessionVisibleStatus, string> = {
  'awaiting-input': 'bg-status-in-review',
  error: 'bg-foreground-destructive',
  completed: 'bg-status-done',
  working: 'bg-status-in-progress',
  // Muted on purpose: real in-flight work, but nothing the user must act on.
  background: 'bg-foreground-passive',
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
  const statusDotClass = sessionStatus.primaryStatus
    ? TASK_SESSION_DOT_CLASSES[sessionStatus.primaryStatus]
    : TASK_LIFECYCLE_DOT_CLASSES[task.data.status];

  return (
    <div
      data-sidebar-task-hover-preview
      className="flex w-full min-w-0 flex-col overflow-hidden text-foreground"
    >
      <div className="border-b border-border/60 bg-background-tertiary-1/25 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-5">{task.data.name}</div>
          </div>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background-tertiary-2/55 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-foreground-tertiary',
              sessionStatus.primaryStatus && 'text-foreground'
            )}
          >
            <span aria-hidden className={cn('size-1.5 rounded-full', statusDotClass)} />
            {statusLabel}
          </span>
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-tertiary-passive">
          <span className="min-w-0 truncate">{projectName}</span>
          {branchName && (
            <>
              <span aria-hidden className="shrink-0 text-foreground-tertiary-muted">
                /
              </span>
              <GitBranch className="size-3 shrink-0" />
              <span className="min-w-0 truncate font-mono">{branchName}</span>
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-foreground-tertiary">
          <span>{t('tasks.sessionInfo.summaryLabel')}</span>
          {latestSummary?.timestamp && <RelativeTime value={latestSummary.timestamp} compact ago />}
        </div>
        <div className="max-h-36 min-w-0 overflow-y-auto overflow-x-hidden break-words [overflow-wrap:anywhere]">
          {isLoading ? (
            <div className="flex justify-center py-3">
              <Spinner size="sm" className="text-foreground-tertiary" />
            </div>
          ) : latestSummary ? (
            <MarkdownRenderer
              content={latestSummary.text}
              variant="compact"
              className="text-xs leading-5"
            />
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border/60 bg-background-tertiary-1/25 px-2.5 py-2 text-xs text-foreground-tertiary-passive">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-foreground-tertiary-muted"
              />
              {t('tasks.panel.noSummary')}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 bg-background-tertiary-1/20 px-3 py-1.5 text-[10px] text-foreground-tertiary-passive">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <MessageSquare className="size-3 shrink-0" />
          <span>{t('tasks.overview.sessions', { count: sessionCount })}</span>
        </span>
        {sessionStatus.backgroundJobCount > 0 && (
          <span className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
            <Cpu className="size-3 shrink-0" />
            <span>
              {t('tasks.backgroundJobs.runningCount', { count: sessionStatus.backgroundJobCount })}
            </span>
          </span>
        )}
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
