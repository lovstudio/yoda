import { Link2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Issue, Task } from '@shared/tasks';
import { openTaskWhenReady } from '@renderer/features/tasks/open-task-when-ready';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

export type ReadyTaskStore = TaskStore & { data: Task };

export function getLinkedIssues(task: Task): Issue[] {
  return task.linkedIssues ?? (task.linkedIssue ? [task.linkedIssue] : []);
}

export function isIssueLinkedToTask(issue: Issue, task: ReadyTaskStore): boolean {
  return getLinkedIssues(task.data).some((linkedIssue) => linkedIssue.url === issue.url);
}

export function getReadyTaskStores(projectId: string): ReadyTaskStore[] {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return [];

  return Array.from(taskManager.tasks.values())
    .filter((store): store is ReadyTaskStore => isRegistered(store))
    .filter((store) => !store.data.archivedAt);
}

export function getLinkedTaskStores(projectId: string, issue: Issue): ReadyTaskStore[] {
  return getReadyTaskStores(projectId).filter((task) => isIssueLinkedToTask(issue, task));
}

function TaskChip({ projectId, task }: { projectId: string; task: ReadyTaskStore }) {
  const { navigate } = useNavigate();

  return (
    <Badge
      variant="outline"
      render={
        <button
          type="button"
          className="max-w-32 justify-start"
          onClick={() => void openTaskWhenReady(projectId, task.data.id, navigate)}
        />
      }
    >
      <span className="min-w-0 truncate">{task.data.name}</span>
    </Badge>
  );
}

export const IssueLinkedTasks = observer(function IssueLinkedTasks({
  issue,
  projectId,
  maxVisible = 3,
  className,
}: {
  issue: Issue;
  projectId: string;
  maxVisible?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const linkedTasks = getLinkedTaskStores(projectId, issue);
  const visibleTasks = linkedTasks.slice(0, maxVisible);
  const hiddenCount = Math.max(0, linkedTasks.length - visibleTasks.length);

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      <span className="text-xs text-foreground-passive">{t('issues.linkedTasks')}</span>
      {linkedTasks.length === 0 ? (
        <span className="text-xs text-foreground-passive">{t('issues.noLinkedTasks')}</span>
      ) : (
        <>
          {visibleTasks.map((task) => (
            <TaskChip key={task.data.id} projectId={projectId} task={task} />
          ))}
          {hiddenCount > 0 ? (
            <Badge variant="secondary">{t('issues.moreTasks', { count: hiddenCount })}</Badge>
          ) : null}
        </>
      )}
    </div>
  );
});

export const IssueTaskLinkPopover = observer(function IssueTaskLinkPopover({
  issue,
  projectId,
  compact = false,
  iconOnly = false,
}: {
  issue: Issue;
  projectId: string;
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const tasks = getReadyTaskStores(projectId);
  const linkedCount = tasks.filter((task) => isIssueLinkedToTask(issue, task)).length;
  const label =
    linkedCount > 0 ? t('issues.manageLinkedTasks', { count: linkedCount }) : t('issues.linkTasks');

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={iconOnly ? 'ghost' : 'outline'}
            size={iconOnly ? 'icon-xs' : compact ? 'xs' : 'sm'}
            aria-label={label}
            title={label}
          >
            <Link2 className="size-3.5" />
            {iconOnly ? null : label}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="text-xs font-medium text-foreground-muted">{t('issues.linkTasks')}</div>
          <div className="text-xs text-foreground-passive">
            {t('issues.linkedTaskCount', { count: linkedCount })}
          </div>
        </div>
        {tasks.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-foreground-passive">
            {t('issues.noTasksToLink')}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {tasks.map((task) => {
              const checked = isIssueLinkedToTask(issue, task);
              const issueCount = getLinkedIssues(task.data).length;

              return (
                <div
                  key={task.data.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                    checked && 'bg-muted/60'
                  )}
                  onClick={() => {
                    if (checked) {
                      void task.unlinkIssue(issue.url);
                    } else {
                      void task.linkIssue(issue);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    if (checked) {
                      void task.unlinkIssue(issue.url);
                    } else {
                      void task.linkIssue(issue);
                    }
                  }}
                >
                  <Checkbox
                    checked={checked}
                    aria-hidden
                    tabIndex={-1}
                    className="pointer-events-none"
                  />
                  <span className="min-w-0 flex-1 truncate">{task.data.name}</span>
                  <span className="shrink-0 text-xs text-foreground-passive">
                    {t('issues.taskIssueCount', { count: issueCount })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
