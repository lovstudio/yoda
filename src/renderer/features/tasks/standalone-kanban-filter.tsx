import { ListFilter } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StandaloneKanbanPane } from '@shared/standalone-kanban-window';
import { SIDEBAR_TASK_PRIORITY_GROUPS, type SidebarTaskPriorityGroup } from '@shared/view-state';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';

/**
 * Board filters. An empty set means "no restriction on this dimension" rather
 * than "hide everything", so a fresh board shows every candidate and clearing a
 * filter is the same operation as never setting one.
 */
export type StandaloneKanbanFilter = {
  statuses: ReadonlySet<SidebarTaskPriorityGroup>;
  projectIds: ReadonlySet<string>;
};

export const EMPTY_STANDALONE_KANBAN_FILTER: StandaloneKanbanFilter = {
  statuses: new Set(),
  projectIds: new Set(),
};

export function isStandaloneKanbanFilterActive(filter: StandaloneKanbanFilter): boolean {
  return filter.statuses.size > 0 || filter.projectIds.size > 0;
}

/**
 * Filter first, cap second. Capping the ranked list before filtering would make
 * a status filter thin out the four already-visible cards instead of pulling in
 * the next matching sessions, which is the opposite of what a filter is for.
 */
export function filterStandaloneKanbanPanes(
  panes: readonly StandaloneKanbanPane[],
  filter: StandaloneKanbanFilter,
  maxPanes: number
): StandaloneKanbanPane[] {
  const matches = panes.filter(
    (pane) =>
      (filter.statuses.size === 0 || filter.statuses.has(pane.status)) &&
      (filter.projectIds.size === 0 || filter.projectIds.has(pane.projectId))
  );
  return matches.slice(0, maxPanes);
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * The board's single header control: one menu holding both filter dimensions,
 * so adding a third later costs a submenu rather than another icon in the strip.
 * Only statuses and projects that actually occur among the candidates are
 * offered — a menu listing all nine priority groups would mostly be dead ends.
 */
export function StandaloneKanbanFilterMenu({
  panes,
  filter,
  onChange,
}: {
  /** All candidates, pre-cap — the options must not depend on what fits on screen. */
  panes: readonly StandaloneKanbanPane[];
  filter: StandaloneKanbanFilter;
  onChange: (filter: StandaloneKanbanFilter) => void;
}) {
  const { t } = useTranslation();
  const active = isStandaloneKanbanFilterActive(filter);

  const presentStatuses = SIDEBAR_TASK_PRIORITY_GROUPS.filter((status) =>
    panes.some((pane) => pane.status === status)
  );
  const presentProjects = [...new Map(panes.map((pane) => [pane.projectId, pane.projectName]))];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('standaloneKanban.filter')}
        title={t('standaloneKanban.filter')}
        className={cn(
          '[-webkit-app-region:no-drag] flex size-6 shrink-0 items-center justify-center rounded hover:bg-background-2 hover:text-foreground',
          active ? 'text-foreground' : 'text-foreground-muted'
        )}
      >
        <ListFilter className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('standaloneKanban.filterByStatus')}
            {filter.statuses.size > 0 && (
              <span className="ml-auto pl-2 text-xs text-foreground-muted">
                {filter.statuses.size}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {presentStatuses.map((status) => (
              <DropdownMenuCheckboxItem
                key={status}
                checked={filter.statuses.has(status)}
                onCheckedChange={() =>
                  onChange({ ...filter, statuses: toggled(filter.statuses, status) })
                }
              >
                {t(`sidebar.priorityGroups.${status}`)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t('standaloneKanban.filterByProject')}
            {filter.projectIds.size > 0 && (
              <span className="ml-auto pl-2 text-xs text-foreground-muted">
                {filter.projectIds.size}
              </span>
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {presentProjects.map(([projectId, projectName]) => (
              <DropdownMenuCheckboxItem
                key={projectId}
                checked={filter.projectIds.has(projectId)}
                onCheckedChange={() =>
                  onChange({ ...filter, projectIds: toggled(filter.projectIds, projectId) })
                }
              >
                <span className="min-w-0 truncate">{projectName}</span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(EMPTY_STANDALONE_KANBAN_FILTER)}>
              {t('standaloneKanban.filterClear')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
