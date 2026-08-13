import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { CLISpinner } from '@renderer/features/tasks/components/cliSpinner';
import { TaskSessionStatusControl } from '@renderer/features/tasks/components/task-session-status-control';
import {
  isUnprovisioned,
  isUnregistered,
  type TaskStore,
} from '@renderer/features/tasks/stores/task';
import {
  taskSessionStatusSummary,
  type TaskSessionStatusSummary,
} from '@renderer/features/tasks/stores/task-selectors';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { getSortInstant } from './sidebar-store';

/**
 * Sidebar tail: spinner while bootstrapping, otherwise the task's agent status
 * in display priority — awaiting-input → unread error/completed → working →
 * manual pending-acceptance flag → idle (relative time). Every agent status opens the
 * shared session manager, so mixed/multiple session states remain inspectable.
 */
export const TaskSidebarAgentStatus = observer(function TaskSidebarAgentStatus({
  task,
  opening = false,
  needsReview = false,
  summary,
}: {
  task: TaskStore;
  opening?: boolean;
  needsReview?: boolean;
  summary?: TaskSessionStatusSummary;
}) {
  const { t } = useTranslation();
  const isBootstrapping =
    isUnregistered(task) || (isUnprovisioned(task) && task.phase === 'provision');

  const delayedIsBootstrapping = useDelayedBoolean(isBootstrapping, 500);
  const delayedIsOpening = useDelayedBoolean(opening, 150);
  const statusSummary = summary ?? taskSessionStatusSummary(task);
  const status = statusSummary.primaryStatus;

  if (delayedIsBootstrapping || delayedIsOpening) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="size-6 flex justify-center items-center">
            <CLISpinner variant="2" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {delayedIsOpening
            ? t('tasks.conversations.startingDescription')
            : t('sidebar.creatingWorkspace')}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (status) {
    return <TaskSessionStatusControl task={task} summary={statusSummary} side="right" />;
  }

  if (needsReview) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="size-6 flex justify-center items-center">
            <span
              aria-label={t('sidebar.needsReview')}
              className="size-1.5 rounded-full bg-status-in-review"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('sidebar.needsReview')}</TooltipContent>
      </Tooltip>
    );
  }

  const sortKind = sidebarStore.taskSortBy === 'created-at' ? 'created' : 'updated';

  return (
    <RelativeTime
      value={getSortInstant(task, sortKind)}
      className="text-xs text-foreground-passive font-mono pr-1 h-full flex items-center"
      compact
    />
  );
});
