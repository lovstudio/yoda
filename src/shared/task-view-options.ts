import { SIDEBAR_TASK_PRIORITY_GROUPS, type SidebarTaskPriorityGroup } from '@shared/view-state';

/**
 * Filtering and sorting for any surface that lists tasks — the kanban view, the
 * standalone board, and whatever comes next. One vocabulary, one set of pure
 * operations, so "filter by status" means the same thing everywhere instead of
 * each view inventing its own menu.
 *
 * Status here is the sidebar priority group (等待输入 / 正在进行 / 已报错 …), the
 * name the product already uses for a task's live state. It is deliberately
 * orthogonal to the kanban board's lifecycle columns: a board can be split into
 * todo/in_progress/review/done *and* filtered down to the sessions awaiting
 * input.
 */
export const TASK_VIEW_SORT_MODES = [
  /** The surface's own order — kanban ranking, column recency, manual order. */
  'default',
  /** The user's dragged ranking of the status classification. */
  'status',
  /** The user's dragged ranking of the project classification. */
  'project',
  'updated-at',
  'created-at',
  'status-changed-at',
  'name',
] as const;
export type TaskViewSortMode = (typeof TASK_VIEW_SORT_MODES)[number];

export type TaskViewOptions = {
  /** Empty means "no restriction", never "hide everything". */
  statuses: readonly SidebarTaskPriorityGroup[];
  projectIds: readonly string[];
  /**
   * Dragged ranking of the classification items. Empty means "not ranked yet":
   * statuses then follow the shipped priority order and projects sort by name,
   * so a rank mode is meaningful before the user has dragged anything.
   */
  statusOrder: readonly SidebarTaskPriorityGroup[];
  projectOrder: readonly string[];
  sortMode: TaskViewSortMode;
  /** Ignored by `default`, whose direction belongs to the surface. */
  sortDescending: boolean;
};

export const DEFAULT_TASK_VIEW_OPTIONS: TaskViewOptions = {
  statuses: [],
  projectIds: [],
  statusOrder: [],
  projectOrder: [],
  sortMode: 'default',
  sortDescending: true,
};

/** The fields any surface must be able to supply for one listed task. */
export type TaskViewItem = {
  projectId: string;
  projectName: string;
  status: SidebarTaskPriorityGroup;
  name: string;
  createdAt: string;
  /** Falls back to `createdAt` when the task has never been interacted with. */
  lastInteractedAt: string;
  statusChangedAt: string;
};

/** The classification a rank mode ranks by, so a drag can name its own sort mode. */
export type TaskViewClassification = 'status' | 'project';

/**
 * The direction a mode should start in. Timestamps read newest-first; a name
 * reads A→Z and a ranking reads rank 1 first. Sharing one flag across modes
 * would otherwise hand the user Z→A the moment they switch from "last used" to
 * "name".
 */
export function defaultSortDescending(mode: TaskViewSortMode): boolean {
  return mode !== 'name' && mode !== 'status' && mode !== 'project';
}

export function isTaskViewSortMode(value: unknown): value is TaskViewSortMode {
  return TASK_VIEW_SORT_MODES.some((mode) => mode === value);
}

export function isTaskViewStatus(value: unknown): value is SidebarTaskPriorityGroup {
  return SIDEBAR_TASK_PRIORITY_GROUPS.some((status) => status === value);
}

export function hasActiveTaskViewFilter(options: TaskViewOptions): boolean {
  return options.statuses.length > 0 || options.projectIds.length > 0;
}

export function isDefaultTaskViewOptions(options: TaskViewOptions): boolean {
  return !hasActiveTaskViewFilter(options) && options.sortMode === 'default';
}

export function matchesTaskViewFilter(item: TaskViewItem, options: TaskViewOptions): boolean {
  return (
    (options.statuses.length === 0 || options.statuses.includes(item.status)) &&
    (options.projectIds.length === 0 || options.projectIds.includes(item.projectId))
  );
}

/**
 * The classification items in ranked order: whatever the user dragged first,
 * then everything the ranking has never seen, in the surface's own order. A
 * status shipped after the drag — or a project added since — therefore appears
 * instead of silently vanishing from the menu.
 */
export function rankedClassification<T extends string>(
  present: readonly T[],
  order: readonly T[]
): T[] {
  const ranked = order.filter((value) => present.includes(value));
  return [...ranked, ...present.filter((value) => !ranked.includes(value))];
}

/**
 * Ranks sort as fixed-width digits so one string comparator covers every mode.
 * The unranked sentinel is a letter, not punctuation: locale collation sorts
 * punctuation *before* digits, which would float unranked items to the top.
 */
const UNRANKED_KEY = 'z';

function rankKey(order: readonly string[], value: string): string {
  const index = order.indexOf(value);
  // An item outside the ranking sorts after every ranked one rather than
  // jumping to the top on rank 0.
  return index === -1 ? UNRANKED_KEY : String(index).padStart(4, '0');
}

function sortKey(item: TaskViewItem, options: TaskViewOptions): string {
  switch (options.sortMode) {
    case 'status':
      return rankKey(
        rankedClassification(SIDEBAR_TASK_PRIORITY_GROUPS, options.statusOrder),
        item.status
      );
    case 'project':
      // Never dragged: group by project name, which is the order the menu shows.
      return options.projectOrder.length > 0
        ? rankKey(options.projectOrder, item.projectId)
        : item.projectName.toLocaleLowerCase();
    case 'created-at':
      return item.createdAt;
    case 'status-changed-at':
      return item.statusChangedAt;
    case 'name':
      return item.name.toLocaleLowerCase();
    case 'updated-at':
    default:
      return item.lastInteractedAt;
  }
}

/**
 * Filter, then sort, then let the caller cap. Capping before filtering would
 * make a filter thin out the rows already on screen instead of pulling in the
 * next matches — the opposite of what a filter is for.
 *
 * `default` preserves the incoming order untouched, so a surface with a
 * meaningful ranking of its own keeps it until the user asks for something else.
 */
export function applyTaskViewOptions<T>(
  rows: readonly T[],
  options: TaskViewOptions,
  toItem: (row: T) => TaskViewItem
): T[] {
  const matched = rows.filter((row) => matchesTaskViewFilter(toItem(row), options));
  if (options.sortMode === 'default') return matched;

  const direction = options.sortDescending ? -1 : 1;
  // Decorate-sort: `toItem` can walk stores, and a comparator would re-run it
  // O(n log n) times.
  return matched
    .map((row, index) => ({ row, index, key: sortKey(toItem(row), options) }))
    .sort((left, right) => {
      const compared = left.key.localeCompare(right.key);
      // Stable: equal keys keep the surface's own order rather than shuffling.
      return compared !== 0 ? compared * direction : left.index - right.index;
    })
    .map((entry) => entry.row);
}
