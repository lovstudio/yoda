import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, FileText, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { TaskRow, type ReadyTask } from './task-row';

function TaskVirtualList({
  tasks,
  selectedIds,
  onToggleSelect,
}: {
  tasks: ReadyTask[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  if (tasks.length === 0) {
    return (
      <EmptyState
        label={t('projects.tasks.noTasks')}
        description={t('projects.tasks.noTasksFound')}
      />
    );
  }

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto min-h-0 flex-1 py-3"
      style={{ scrollbarWidth: 'none' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const task = tasks[virtualItem.index]!;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={cn(virtualItem.index === tasks.length - 1 && 'border-b-0')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TaskRow
                task={task}
                isSelected={selectedIds.has(task.data.id)}
                onToggleSelect={() => onToggleSelect(task.data.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectionBar({
  count,
  tab,
  onClear,
  onArchive,
  onRestore,
  onDelete,
}: {
  count: number;
  tab: 'active' | 'archived';
  onClear: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;

  return (
    <ListPopoverCard className="justify-between">
      <span className="text-foreground-muted whitespace-nowrap">
        {t('projects.tasks.selectedCount', { count })}
      </span>
      <div className="flex items-center gap-2">
        {tab === 'active' && (
          <Button variant="outline" size="sm" onClick={onArchive}>
            <Archive className="size-3.5" />
            {t('sidebar.archiveTask')}
          </Button>
        )}
        {tab === 'archived' && (
          <Button variant="outline" size="sm" onClick={onRestore}>
            <RotateCcw className="size-3.5" />
            {t('projects.tasks.restore')}
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="size-3.5" />
          {t('common.delete')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          aria-label={t('projects.tasks.clearSelection')}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </ListPopoverCard>
  );
}

export const TaskList = observer(function TaskList() {
  const { t } = useTranslation();
  const {
    params: { projectId },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));
  const taskManager = getTaskManagerStore(projectId);
  const showConfirm = useShowModal('confirmActionModal');
  const showCreateTaskModal = useShowModal('taskModal');

  const taskView = store?.view.taskView ?? null;
  const showCommandPalette = useShowModal('commandPaletteModal');

  const allTasks = taskManager
    ? Array.from(taskManager.tasks.values()).filter(
        (t): t is ReadyTask => t.state !== 'unregistered'
      )
    : [];
  const activeTasks = allTasks.filter((t) => !t.data.archivedAt);
  const archivedTasks = allTasks.filter((t) => Boolean(t.data.archivedAt));

  if (!taskView) return null;

  const displayTasks = taskView.tab === 'active' ? activeTasks : archivedTasks;
  const onlyWithNote = taskView.tab === 'archived' && taskView.archivedOnlyWithNote;
  const noteFiltered = onlyWithNote
    ? displayTasks.filter((t) => Boolean(t.data.archiveNote?.trim()))
    : displayTasks;
  const q = taskView.searchQuery.trim().toLowerCase();
  const filteredTasks = q
    ? noteFiltered.filter((t) => {
        if (t.data.name.toLowerCase().includes(q)) return true;
        const note = t.data.archiveNote;
        return note ? note.toLowerCase().includes(q) : false;
      })
    : noteFiltered;

  const clearSelection = () => taskView.setSelectedIds(new Set());

  const bulkArchive = () => {
    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.archiveTask(id));
    clearSelection();
  };

  const bulkRestore = () => {
    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.restoreTask(id));
    clearSelection();
  };

  const bulkDelete = () => {
    const count = taskView.selectedIds.size;
    showConfirm({
      title: t('projects.tasks.deleteTitle', { count }),
      description: t('projects.tasks.deleteDescription'),
      confirmLabel: t('projects.tasks.deleteConfirm', { count }),
      onSuccess: () => {
        const ids = [...taskView.selectedIds];
        ids.forEach((id) => void taskManager?.deleteTask(id));
        clearSelection();
      },
    });
  };

  return (
    <div className="relative flex flex-col max-w-3xl mx-auto w-full h-full pt-6 px-6 min-h-0">
      <div className="flex flex-col gap-4 border-b border-border pb-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap justify-between">
          <ToggleGroup
            multiple={false}
            value={[taskView.tab]}
            onValueChange={([value]) => {
              if (value) taskView.setTab(value as 'active' | 'archived');
            }}
          >
            <ToggleGroupItem value="active">
              {t('projects.tasks.activeWithCount', { count: activeTasks.length })}
            </ToggleGroupItem>
            <ToggleGroupItem value="archived">
              {t('projects.tasks.archivedWithCount', { count: archivedTasks.length })}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <SearchInput
              placeholder={t('projects.tasks.searchPlaceholder')}
              value={taskView.searchQuery}
              onChange={(e) => taskView.setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  showCommandPalette({
                    projectId,
                    initialQuery: taskView.searchQuery,
                  });
                }
              }}
              className="flex-1"
            />
            {taskView.tab === 'archived' && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      variant="outline"
                      size="sm"
                      pressed={taskView.archivedOnlyWithNote}
                      onPressedChange={(pressed) => taskView.setArchivedOnlyWithNote(pressed)}
                      aria-label={t('projects.tasks.onlyWithNotesAria')}
                    >
                      <FileText className="size-3.5" />
                    </Toggle>
                  }
                />
                <TooltipContent>{t('projects.tasks.onlyWithNotes')}</TooltipContent>
              </Tooltip>
            )}
            <Button onClick={() => showCreateTaskModal({ projectId })}>
              {t('tasks.createTask')} <ShortcutHint settingsKey="newTask" />
            </Button>
          </div>
        </div>
      </div>

      <TaskVirtualList
        tasks={filteredTasks}
        selectedIds={taskView.selectedIds}
        onToggleSelect={(id) => taskView.toggleSelect(id)}
      />

      <SelectionBar
        count={taskView.selectedIds.size}
        tab={taskView.tab}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onRestore={bulkRestore}
        onDelete={bulkDelete}
      />
    </div>
  );
});
