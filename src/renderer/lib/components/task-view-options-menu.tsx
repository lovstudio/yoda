import { ArrowDownWideNarrow, ArrowUpWideNarrow, ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TASK_VIEW_OPTIONS,
  defaultSortDescending,
  hasActiveTaskViewFilter,
  isDefaultTaskViewOptions,
  TASK_VIEW_SORT_MODES,
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
 * filter, project filter, sort mode and direction in one menu.
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

  const presentStatuses = SIDEBAR_TASK_PRIORITY_GROUPS.filter((status) =>
    items.some((item) => item.status === status)
  );
  const presentProjects = [...new Map(items.map((item) => [item.projectId, item.projectName]))];
  // A dropped project keeps filtering forever if it is left in the list while
  // no longer selectable, so prune selections the surface can no longer offer.
  const pruneMissing = (next: TaskViewOptions): TaskViewOptions => ({
    ...next,
    projectIds: next.projectIds.filter((id) =>
      presentProjects.some(([projectId]) => projectId === id)
    ),
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
            {presentStatuses.map((status: SidebarTaskPriorityGroup) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={options.statuses.includes(status)}
                onCheckedChange={() =>
                  onChange(
                    pruneMissing({ ...options, statuses: toggledValue(options.statuses, status) })
                  )
                }
              >
                {t(`sidebar.priorityGroups.${status}`)}
              </DropdownMenuCheckboxItem>
            ))}
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
            {presentProjects.map(([projectId, projectName]) => (
              <DropdownMenuCheckboxItem
                key={projectId}
                checked={options.projectIds.includes(projectId)}
                onCheckedChange={() =>
                  onChange(
                    pruneMissing({
                      ...options,
                      projectIds: toggledValue(options.projectIds, projectId),
                    })
                  )
                }
              >
                <span className="min-w-0 truncate">{projectName}</span>
              </DropdownMenuCheckboxItem>
            ))}
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
