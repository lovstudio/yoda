import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isKanbanStatus, KANBAN_STATUSES, type KanbanStatus } from '@shared/kanban';
import { projectDisplayName } from '@shared/projects';
import {
  applyTaskViewOptions,
  DEFAULT_TASK_VIEW_OPTIONS,
  hasActiveTaskViewFilter,
  type TaskViewItem,
  type TaskViewOptions,
} from '@shared/task-view-options';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { StatusIcon } from '@renderer/features/tasks/components/lifecycleStatusIndicator';
import { registeredTaskData } from '@renderer/features/tasks/stores/task';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { taskViewItemFields } from '@renderer/features/tasks/stores/task-view-item';
import { TaskViewOptionsMenu } from '@renderer/lib/components/task-view-options-menu';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Badge } from '@renderer/lib/ui/badge';
import { cn } from '@renderer/utils/utils';
import { ColumnHooksPopover } from './ColumnHooksPopover';
import { KanbanCard, KanbanCardContent, suppressCardClicks, type BoardCard } from './KanbanCard';

export const COLUMN_LABEL_KEYS: Record<KanbanStatus, string> = {
  todo: 'tasks.lifecycle.todo',
  in_progress: 'tasks.lifecycle.inProgress',
  review: 'tasks.lifecycle.review',
  done: 'tasks.lifecycle.done',
};

function collectBoardCards(): Record<KanbanStatus, BoardCard[]> {
  const byStatus: Record<KanbanStatus, BoardCard[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  for (const project of getProjectManagerStore().projects.values()) {
    const mounted = project.mountedProject;
    if (!mounted) continue;
    for (const store of mounted.taskManager.tasks.values()) {
      const data = registeredTaskData(store);
      if (!data || data.archivedAt || data.archiveRequestedAt) continue;
      if (!isKanbanStatus(data.status)) continue;
      byStatus[data.status].push({
        projectId: data.projectId,
        projectName: projectDisplayName(mounted.data),
        task: data,
        taskStore: store,
      });
    }
  }
  for (const status of KANBAN_STATUSES) {
    byStatus[status].sort((a, b) => b.task.statusChangedAt.localeCompare(a.task.statusChangedAt));
  }
  return byStatus;
}

/**
 * Board cards feed the shared view-options menu like every other task list.
 * Filtering here is by the task's *live* status (等待输入 / 正在进行 …), which is
 * orthogonal to the column it sits in — the columns are lifecycle stages.
 */
function boardCardViewItem(card: BoardCard): TaskViewItem {
  return {
    projectId: card.projectId,
    ...taskViewItemFields(
      card.taskStore,
      sidebarStore.taskPriorityGroup(card.taskStore),
      card.projectName
    ),
  };
}

function moveCard(card: BoardCard, toStatus: KanbanStatus, failureTitle: string): void {
  const store = getTaskStore(card.projectId, card.task.id);
  const data = store ? registeredTaskData(store) : undefined;
  if (!data || data.status === toStatus) return;

  const previous = { status: data.status, statusChangedAt: data.statusChangedAt };
  // Optimistic: the card lands instantly; the main process re-broadcasts the
  // authoritative transition (and runs the column hooks) on its own clock.
  runInAction(() => {
    data.status = toStatus;
    data.statusChangedAt = new Date().toISOString();
  });
  rpc.tasks.moveTaskStatus(card.projectId, card.task.id, previous.status, toStatus).catch(() => {
    runInAction(() => {
      data.status = previous.status;
      data.statusChangedAt = previous.statusChangedAt;
    });
    toast({ title: failureTitle, variant: 'destructive' });
  });
}

export const KanbanBoard = observer(function KanbanBoard() {
  const { t } = useTranslation();
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  const [viewOptions, setViewOptions] = useState<TaskViewOptions>(DEFAULT_TASK_VIEW_OPTIONS);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const allByStatus = collectBoardCards();
  const allCards = KANBAN_STATUSES.flatMap((status) => allByStatus[status]);
  // Filter and sort inside each column: a column is a lifecycle stage, so cards
  // must never migrate between columns because of a view option.
  const byStatus = Object.fromEntries(
    KANBAN_STATUSES.map((status) => [
      status,
      applyTaskViewOptions(allByStatus[status], viewOptions, boardCardViewItem),
    ])
  ) as Record<KanbanStatus, BoardCard[]>;
  const filteredEmpty =
    hasActiveTaskViewFilter(viewOptions) &&
    allCards.length > 0 &&
    KANBAN_STATUSES.every((status) => byStatus[status].length === 0);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCard((event.active.data.current as { card: BoardCard } | undefined)?.card ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveCard(null);
    suppressCardClicks();
    const card = (event.active.data.current as { card: BoardCard } | undefined)?.card;
    const toStatus = event.over?.id;
    if (!card || typeof toStatus !== 'string') return;
    if (!(KANBAN_STATUSES as readonly string[]).includes(toStatus)) return;
    moveCard(card, toStatus as KanbanStatus, t('kanban.moveFailed'));
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveCard(null)}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 px-4 pt-3">
          <Badge variant="secondary" className="text-[10px]">
            Alpha
          </Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground-tertiary-passive">
            {filteredEmpty ? t('taskViewOptions.emptyFiltered') : t('kanban.alphaHint')}
          </span>
          <TaskViewOptionsMenu
            items={allCards.map(boardCardViewItem)}
            options={viewOptions}
            onChange={setViewOptions}
          />
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {KANBAN_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              cards={byStatus[status]}
              dragActive={activeCard !== null}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCard && <KanbanCardContent card={activeCard} dragging />}
      </DragOverlay>
    </DndContext>
  );
});

const KanbanColumn = observer(function KanbanColumn({
  status,
  cards,
  dragActive,
}: {
  status: KanbanStatus;
  cards: BoardCard[];
  dragActive: boolean;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-lg border border-border bg-background-secondary transition-colors',
        isOver && 'border-border-focused bg-background-tertiary-1'
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <StatusIcon status={status} className="size-3.5" />
        <span className="text-sm font-medium text-foreground">{t(COLUMN_LABEL_KEYS[status])}</span>
        <span className="text-xs tabular-nums text-foreground-tertiary-passive">
          {cards.length}
        </span>
        <div className="ml-auto">
          <ColumnHooksPopover status={status} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => (
          <KanbanCard
            key={`${card.projectId}::${card.task.id}`}
            card={card}
            dragActive={dragActive}
          />
        ))}
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border py-8 text-xs text-foreground-tertiary-passive">
            {t('kanban.emptyColumn')}
          </div>
        )}
      </div>
    </div>
  );
});
