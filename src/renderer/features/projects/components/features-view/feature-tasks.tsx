import { Link2, ListTodo, LockKeyhole, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Feature } from '@shared/features';
import type { useFeatureMutations } from '@renderer/features/features/use-features';
import { getReadyTaskStores } from '@renderer/features/projects/components/issues-view/issue-task-links';
import { StatusIcon } from '@renderer/features/tasks/components/lifecycleStatusIndicator';
import { openTaskWhenReady } from '@renderer/features/tasks/open-task-when-ready';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

export const FeatureTasks = observer(function FeatureTasks({
  projectId,
  feature,
  mutations,
}: {
  projectId: string;
  feature: Feature;
  mutations: ReturnType<typeof useFeatureMutations>;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const tasks = getReadyTaskStores(projectId);
  const linkedIds = new Set(feature.tasks.map((task) => task.taskId));
  const workflowRoomIds = new Map(
    feature.tasks
      .filter((task) => task.workflowRoomId)
      .map((task) => [task.taskId, task.workflowRoomId])
  );

  return (
    <section className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
          <ListTodo className="size-3.5" />
          {t('featureDelivery.tasks.title')}
          <span className="font-mono text-[10px] text-foreground-passive">
            {feature.tasks.length}
          </span>
        </h3>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="xs">
                <Link2 className="size-3" />
                {t('featureDelivery.tasks.manage')}
              </Button>
            }
          />
          <PopoverContent align="end" className="w-80 p-2">
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <span className="text-xs font-medium text-foreground-muted">
                {t('featureDelivery.tasks.manage')}
              </span>
              <span className="text-[10px] text-foreground-passive">
                {t('featureDelivery.tasks.linkedCount', { count: linkedIds.size })}
              </span>
            </div>
            {tasks.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-foreground-passive">
                {t('featureDelivery.tasks.noTasks')}
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {tasks.map((task) => {
                  const checked = linkedIds.has(task.data.id);
                  const workflowOwned = Boolean(workflowRoomIds.get(task.data.id));
                  return (
                    <button
                      key={task.data.id}
                      type="button"
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                        checked && 'bg-muted/60'
                      )}
                      disabled={mutations.setTaskLinked.isPending || workflowOwned}
                      title={
                        workflowOwned ? t('featureDelivery.tasks.activeWorkflowLocked') : undefined
                      }
                      onClick={() =>
                        mutations.setTaskLinked.mutate({ taskId: task.data.id, linked: !checked })
                      }
                    >
                      <Checkbox
                        checked={checked}
                        aria-hidden
                        tabIndex={-1}
                        className="pointer-events-none"
                      />
                      <span className="min-w-0 flex-1 truncate">{task.data.name}</span>
                      <StatusIcon status={task.data.status} />
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {feature.tasks.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-passive">
          {t('featureDelivery.tasks.none')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {feature.tasks.map((task) => (
            <Badge
              key={task.taskId}
              variant="outline"
              className="h-6 max-w-full gap-1.5 px-2 text-xs font-normal"
            >
              <StatusIcon status={task.status} />
              <button
                type="button"
                className="max-w-48 truncate hover:underline"
                onClick={() => void openTaskWhenReady(projectId, task.taskId, navigate)}
              >
                {task.name}
              </button>
              <span className="text-[9px] text-foreground-passive">
                {task.archivedAt
                  ? t('featureDelivery.tasks.archived')
                  : t(
                      task.status === 'in_progress'
                        ? 'tasks.lifecycle.inProgress'
                        : `tasks.lifecycle.${task.status}`
                    )}
              </span>
              {task.workflowRoomId ? (
                <span
                  className="-mr-1 flex size-4 items-center justify-center text-foreground-passive"
                  title={t('featureDelivery.tasks.activeWorkflowLocked')}
                  aria-label={t('featureDelivery.tasks.activeWorkflowLocked')}
                >
                  <LockKeyhole className="size-2.5" />
                </span>
              ) : (
                <button
                  type="button"
                  className="-mr-1 flex size-4 items-center justify-center rounded-full text-foreground-passive hover:bg-background-2 hover:text-foreground"
                  aria-label={t('featureDelivery.tasks.unlink', { title: task.name })}
                  disabled={mutations.setTaskLinked.isPending}
                  onClick={() =>
                    mutations.setTaskLinked.mutate({ taskId: task.taskId, linked: false })
                  }
                >
                  <X className="size-2.5" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
});
