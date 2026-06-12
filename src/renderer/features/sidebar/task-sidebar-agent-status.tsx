import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { CLISpinner } from '@renderer/features/tasks/components/cliSpinner';
import {
  isUnprovisioned,
  isUnregistered,
  registeredTaskData,
  type TaskStore,
} from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  nextAttentionConversationId,
  taskNotificationStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { getSortInstant } from './sidebar-store';

/**
 * Sidebar tail: spinner while bootstrapping, otherwise the task's notification
 * signal — only statuses that need the user (awaiting-input / unread
 * error/completed; running state lives on the session tabs instead). Clicking
 * the signal jumps to the next session that needs consuming, cycling past the
 * one already in view.
 */
export const TaskSidebarAgentStatus = observer(function TaskSidebarAgentStatus({
  task,
  needsReview = false,
}: {
  task: TaskStore;
  needsReview?: boolean;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const isBootstrapping =
    isUnregistered(task) ||
    (isUnprovisioned(task) && (task.phase === 'provision' || task.phase === 'provision-error'));

  const delayedIsBootstrapping = useDelayedBoolean(isBootstrapping, 500);
  const status = taskNotificationStatus(task);

  if (delayedIsBootstrapping) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="size-6 flex justify-center items-center">
            <CLISpinner variant="2" />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('sidebar.creatingWorkspace')}</TooltipContent>
      </Tooltip>
    );
  }

  if (status) {
    const data = registeredTaskData(task);
    const button = (
      <button
        type="button"
        aria-label={t('sidebar.openPendingSession')}
        className="flex size-6 items-center justify-center rounded-md hover:bg-background-tertiary-2"
        onClick={(event) => {
          event.stopPropagation();
          if (!data) return;
          const activeConversationId =
            asProvisioned(task)?.taskView.tabManager.activeConversationId;
          const conversationId = nextAttentionConversationId(task, activeConversationId);
          openTaskTarget({ projectId: data.projectId, taskId: data.id, conversationId }, navigate);
        }}
      >
        <AgentStatusIndicator status={status} disableTooltip boxClassName="size-4" />
      </button>
    );
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>
          {t(`agentStatus.${status}`)} · {t('sidebar.openPendingSession')}
        </TooltipContent>
      </Tooltip>
    );
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
