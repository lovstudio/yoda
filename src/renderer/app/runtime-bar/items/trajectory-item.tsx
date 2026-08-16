import { Timer } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_BAR_CARD_CLASS } from '@renderer/app/workspace-bar-card';
import {
  formatTrajectoryDuration,
  useTaskOpenTrajectories,
  WorkspaceTrajectoryPopover,
} from '@renderer/app/workspace-trajectory-popover';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';

/**
 * How long the last task took to open, broken down by stage. Absent until a task
 * has actually been opened — there is nothing to report before the first one.
 */
export const RuntimeBarTrajectoryItem = observer(function RuntimeBarTrajectoryItem() {
  const { t } = useTranslation();
  const [isTrajectoryPopoverOpen, setIsTrajectoryPopoverOpen] = useState(false);
  const taskOpenTrajectories = useTaskOpenTrajectories();
  const lastTaskOpenTrajectory = taskOpenTrajectories[0];
  if (!lastTaskOpenTrajectory) return null;

  return (
    <Popover open={isTrajectoryPopoverOpen} onOpenChange={setIsTrajectoryPopoverOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.trajectory.triggerLabel')}
        title={t('workspaceRuntime.trajectory.triggerLabel')}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          isTrajectoryPopoverOpen ? 'bg-background-2 text-foreground' : 'text-foreground-passive'
        )}
      >
        <Timer aria-hidden className="size-3.5" />
        <span className={cn(RUNTIME_BAR_ACTION_LABEL_CLASS, 'font-mono tabular-nums')}>
          {lastTaskOpenTrajectory.totalMs === null
            ? '—'
            : formatTrajectoryDuration(lastTaskOpenTrajectory.totalMs)}
        </span>
      </PopoverTrigger>
      {isTrajectoryPopoverOpen ? (
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className={cn(WORKSPACE_BAR_CARD_CLASS, 'w-[30rem]')}
        >
          <WorkspaceTrajectoryPopover
            trajectories={taskOpenTrajectories}
            resolveTaskName={(projectId, taskId) => getTaskStore(projectId, taskId)?.data.name}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
});
