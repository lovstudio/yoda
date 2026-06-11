import { ArchiveRestore, ListPlus, ListTree } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task, TaskLifecycleStatus } from '@shared/tasks';
import { registeredTaskData, type TaskStore } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore, taskChildren } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { ArchivedDisclosure } from '../components/archived-disclosure';

const LIFECYCLE_LABEL_KEY: Record<TaskLifecycleStatus, string> = {
  todo: 'tasks.lifecycle.todo',
  in_progress: 'tasks.lifecycle.inProgress',
  review: 'tasks.lifecycle.review',
  done: 'tasks.lifecycle.done',
  cancelled: 'tasks.lifecycle.cancelled',
};

function archivedTime(value: string | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

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

  const children: TaskStore[] = [];
  const archived: TaskStore[] = [];
  for (const store of taskChildren(projectId, taskId)) {
    (registeredTaskData(store)?.archivedAt ? archived : children).push(store);
  }
  archived.sort(
    (a, b) =>
      archivedTime(registeredTaskData(b)?.archivedAt) -
      archivedTime(registeredTaskData(a)?.archivedAt)
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
      {archived.length > 0 && (
        <ArchivedDisclosure
          label={t('tasks.overview.archivedSubtasks', { count: archived.length })}
        >
          <ul className="flex flex-col gap-1">
            {archived.map((store) => (
              <ArchivedSubtaskRow
                key={store.data.id}
                store={store}
                projectId={projectId}
                onOpen={() => navigate('task', { projectId, taskId: store.data.id })}
              />
            ))}
          </ul>
        </ArchivedDisclosure>
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

/**
 * One archived subtask row: clicking opens the task view for review (archive
 * state untouched); the explicit restore button unarchives the subtree.
 */
const ArchivedSubtaskRow = observer(function ArchivedSubtaskRow({
  store,
  projectId,
  onOpen,
}: {
  store: TaskStore;
  projectId: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const data: Task | undefined = registeredTaskData(store);

  const handleRestore = async () => {
    if (busy) return;
    const manager = getTaskManagerStore(projectId);
    if (!manager) return;
    setBusy(true);
    try {
      await manager.restoreTask(store.data.id);
    } catch (error) {
      log.warn('ArchivedSubtaskRow: failed to restore subtask', {
        taskId: store.data.id,
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-lg border border-border/40 transition-colors hover:bg-background-1',
        busy && 'opacity-60'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-2 pl-3 pr-1 text-left text-sm text-foreground-passive transition-colors hover:text-foreground-muted"
      >
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate" title={store.data.name}>
            {store.data.name}
          </span>
          <RelativeTime
            value={data?.archivedAt ?? ''}
            className="shrink-0 font-mono text-xs text-foreground-passive"
            compact
          />
        </span>
        {data?.archiveNote && (
          <span
            className="min-w-0 truncate text-xs text-foreground-passive"
            title={data.archiveNote}
          >
            {data.archiveNote}
          </span>
        )}
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        title={t('projects.tasks.restore')}
        aria-label={t('projects.tasks.restore')}
        className="mr-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => void handleRestore()}
      >
        <ArchiveRestore className="size-3.5" />
      </Button>
    </li>
  );
});
