import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, GripVertical, ListFilter } from 'lucide-react';
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TASK_VIEW_OPTIONS,
  defaultSortDescending,
  hasActiveTaskViewFilter,
  isDefaultTaskViewOptions,
  rankedClassification,
  TASK_VIEW_SORT_MODES,
  type TaskViewClassification,
  type TaskViewItem,
  type TaskViewOptions,
  type TaskViewSortMode,
} from '@shared/task-view-options';
import { SIDEBAR_TASK_PRIORITY_GROUPS, type SidebarTaskPriorityGroup } from '@shared/view-state';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

const SORT_LABEL_KEYS: Record<TaskViewSortMode, string> = {
  default: 'taskViewOptions.sortDefault',
  status: 'taskViewOptions.sortStatus',
  project: 'taskViewOptions.sortProject',
  'updated-at': 'taskViewOptions.sortUpdatedAt',
  'created-at': 'taskViewOptions.sortCreatedAt',
  'status-changed-at': 'taskViewOptions.sortStatusChangedAt',
  name: 'taskViewOptions.sortName',
};

function withoutValue<T>(values: readonly T[], value: T): T[] {
  return values.filter((entry) => entry !== value);
}

function toggledValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? withoutValue(values, value) : [...values, value];
}

/**
 * The shared view-options control for every surface that lists tasks: status
 * filter, project filter, classification ranking, sort mode and direction in one
 * menu.
 *
 * One menu rather than a row of controls — a surface header has room for a
 * single affordance, and a new dimension should cost a submenu instead of
 * another icon. Both dimensions offer only values present in `items`, so the
 * menu never lists a choice that would empty the surface.
 */
export function TaskViewOptionsMenu({
  items,
  options,
  onChange,
  align = 'end',
  className,
}: {
  /** Every candidate, before filtering — the offered values must not depend on the current filter. */
  items: readonly TaskViewItem[];
  options: TaskViewOptions;
  onChange: (options: TaskViewOptions) => void;
  align?: 'start' | 'end';
  className?: string;
}) {
  const { t } = useTranslation();
  const customized = !isDefaultTaskViewOptions(options);
  const filtered = hasActiveTaskViewFilter(options);

  const presentStatuses = rankedClassification(
    SIDEBAR_TASK_PRIORITY_GROUPS.filter((status) => items.some((item) => item.status === status)),
    options.statusOrder
  );
  const projectNames = new Map(items.map((item) => [item.projectId, item.projectName]));
  const presentProjects = rankedClassification(
    [...projectNames.keys()].sort((left, right) =>
      (projectNames.get(left) ?? '').localeCompare(projectNames.get(right) ?? '')
    ),
    options.projectOrder
  );
  // A dropped project keeps filtering forever if it is left in the list while
  // no longer selectable, so prune selections the surface can no longer offer.
  const pruneMissing = (next: TaskViewOptions): TaskViewOptions => ({
    ...next,
    projectIds: next.projectIds.filter((id) => presentProjects.includes(id)),
  });

  /**
   * A drag is only meaningful if the list is actually ranked by it, so the drop
   * names its own sort mode. Leaving the mode alone would make the gesture look
   * broken until the user found the sort submenu.
   */
  const ranked = (classification: TaskViewClassification, next: Partial<TaskViewOptions>) =>
    onChange({
      ...options,
      ...next,
      sortMode: classification,
      sortDescending: defaultSortDescending(classification),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('taskViewOptions.menu')}
        title={t('taskViewOptions.menu')}
        className={cn(
          '[-webkit-app-region:no-drag] flex size-6 shrink-0 items-center justify-center rounded hover:bg-background-2 hover:text-foreground',
          customized ? 'text-foreground' : 'text-foreground-muted',
          className
        )}
      >
        <ListFilter className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('taskViewOptions.filterByStatus')}
            {options.statuses.length > 0 && (
              <span className="ml-auto pl-2 text-xs tabular-nums text-foreground-muted">
                {options.statuses.length}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ClassificationList
              values={presentStatuses}
              selected={options.statuses}
              renderLabel={(status: SidebarTaskPriorityGroup) =>
                t(`sidebar.priorityGroups.${status}`)
              }
              onToggle={(status) =>
                onChange(
                  pruneMissing({ ...options, statuses: toggledValue(options.statuses, status) })
                )
              }
              onReorder={(statusOrder) => ranked('status', { statusOrder })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('taskViewOptions.filterByProject')}
            {options.projectIds.length > 0 && (
              <span className="ml-auto pl-2 text-xs tabular-nums text-foreground-muted">
                {options.projectIds.length}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ClassificationList
              values={presentProjects}
              selected={options.projectIds}
              renderLabel={(projectId) => projectNames.get(projectId) ?? projectId}
              onToggle={(projectId) =>
                onChange(
                  pruneMissing({
                    ...options,
                    projectIds: toggledValue(options.projectIds, projectId),
                  })
                )
              }
              onReorder={(projectOrder) => ranked('project', { projectOrder })}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('taskViewOptions.sortBy')}
            <span className="ml-auto min-w-0 truncate pl-2 text-xs text-foreground-muted">
              {t(SORT_LABEL_KEYS[options.sortMode])}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={options.sortMode}
              onValueChange={(next) => {
                const sortMode = next as TaskViewSortMode;
                onChange({ ...options, sortMode, sortDescending: defaultSortDescending(sortMode) });
              }}
            >
              {TASK_VIEW_SORT_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode} closeOnClick>
                  {t(SORT_LABEL_KEYS[mode])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {options.sortMode !== 'default' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={() => onChange({ ...options, sortDescending: !options.sortDescending })}
                >
                  {t(
                    options.sortDescending
                      ? 'taskViewOptions.sortDescending'
                      : 'taskViewOptions.sortAscending'
                  )}
                  {options.sortDescending ? (
                    <ArrowDownWideNarrow className="ml-auto size-3.5 text-foreground-muted" />
                  ) : (
                    <ArrowUpWideNarrow className="ml-auto size-3.5 text-foreground-muted" />
                  )}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {customized && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(DEFAULT_TASK_VIEW_OPTIONS)}>
              {t(filtered ? 'taskViewOptions.reset' : 'taskViewOptions.resetSort')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One classification's items: a checkbox to filter by it, a handle to rank it.
 * Filtering and ranking are the same list because they answer the same question
 * about the same items — splitting them into two menus would ask the user to
 * find "状态" twice.
 */
function ClassificationList<T extends string>({
  values,
  selected,
  renderLabel,
  onToggle,
  onReorder,
}: {
  values: readonly T[];
  selected: readonly T[];
  renderLabel: (value: T) => ReactNode;
  onToggle: (value: T) => void;
  onReorder: (values: T[]) => void;
}) {
  const { t } = useTranslation();
  // A short activation distance so a press that lands on the handle still reads
  // as a click when it never moves.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return;
          const from = values.indexOf(active.id as T);
          const to = values.indexOf(over.id as T);
          if (from < 0 || to < 0) return;
          onReorder(arrayMove([...values], from, to));
        }}
      >
        <SortableContext items={[...values]} strategy={verticalListSortingStrategy}>
          {values.map((value) => (
            <ClassificationRow
              key={value}
              id={value}
              checked={selected.includes(value)}
              onToggle={() => onToggle(value)}
            >
              {renderLabel(value)}
            </ClassificationRow>
          ))}
        </SortableContext>
      </DndContext>
      {values.length > 1 && (
        <p className="px-2 pt-1 pb-0.5 text-[11px] text-foreground-passive">
          {t('taskViewOptions.reorderHint')}
        </p>
      )}
    </>
  );
}

function ClassificationRow({
  id,
  checked,
  onToggle,
  children,
}: {
  id: string;
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const dragProps = {
    ...listeners,
    // Keep the gesture on the handle: the row is a menu item, so a press on it
    // would toggle the filter and Base UI would move focus mid-drag.
    onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => {
      event.stopPropagation();
      listeners?.onPointerDown?.(event);
    },
    onClick: (event: ReactMouseEvent<HTMLSpanElement>) => event.stopPropagation(),
  };

  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onToggle}
      className={cn('pl-1', isDragging && 'bg-background-quaternary-1')}
      render={
        <div
          ref={setNodeRef}
          style={{
            // Vertical only: a list has one axis, and horizontal drift would
            // read as a drag-out gesture the menu cannot accept.
            transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
            transition,
            zIndex: isDragging ? 1 : undefined,
          }}
        />
      }
    >
      <span
        {...dragProps}
        ref={setActivatorNodeRef}
        aria-label={t('taskViewOptions.reorder')}
        className="flex size-4 shrink-0 cursor-grab items-center justify-center text-foreground-passive hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuCheckboxItem>
  );
}
