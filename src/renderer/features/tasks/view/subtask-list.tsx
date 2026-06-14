import { ListPlus, ListTree } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import { taskChildren } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';

const LIFECYCLE_LABEL_KEY: Record<TaskLifecycleStatus, string> = {
  todo: 'tasks.lifecycle.todo',
  in_progress: 'tasks.lifecycle.inProgress',
  review: 'tasks.lifecycle.review',
  done: 'tasks.lifecycle.done',
  cancelled: 'tasks.lifecycle.cancelled',
};

/** Subtasks of the current task — Overview tab section with a create entry. */
export const SubtaskList = observer(function SubtaskList({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showCreateSubtask = useShowModal('newSubtaskModal');
  const showSetParent = useShowModal('setParentTaskModal');

  const children = taskChildren(projectId, taskId).filter(
    (store) => !registeredTaskData(store)?.archivedAt
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          {t('tasks.overview.subtasks', { count: children.length })}
        </h2>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => showSetParent({ projectId, taskId })}>
            <ListTree className="size-4" />
            {t('tasks.context.setParent')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => showCreateSubtask({ projectId, parentTaskId: taskId })}
          >
            <ListPlus className="size-4" />
            {t('tasks.context.createSubtask')}
          </Button>
        </div>
      </div>
      {children.length > 0 && (
        <ul className="flex flex-col gap-1">
          {children.map((store) => (
            <SubtaskRow
              key={store.data.id}
              store={store}
              onOpen={() => navigate('task', { projectId, taskId: store.data.id })}
            />
          ))}
        </ul>
      )}
    </section>
  );
});

const SubtaskRow = observer(function SubtaskRow({
  store,
  onOpen,
}: {
  store: TaskStore;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const data = registeredTaskData(store);
  const status = data?.status;
  const isDone = status === 'done' || status === 'cancelled';

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground"
      >
        <span
          className={cn('min-w-0 flex-1 truncate', isDone && 'line-through decoration-1')}
          title={store.data.name}
        >
          {store.data.name}
        </span>
        {status && (
          <span className="shrink-0 rounded-sm bg-background-tertiary-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-foreground-tertiary">
            {t(LIFECYCLE_LABEL_KEY[status])}
          </span>
        )}
      </button>
    </li>
  );
});
