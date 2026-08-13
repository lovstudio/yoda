import { DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT } from '@shared/view-state';

export type SidebarTaskGroupRowVariant = 'underProject' | 'pinned' | 'flat';

export const SIDEBAR_TASK_GROUP_REVEAL_INCREMENT = 10;

export function getSidebarTaskGroupDisclosure<T>(
  items: readonly T[],
  visibleCount: number = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT,
  totalCount: number = items.length
): { visibleItems: T[]; hiddenCount: number } {
  const normalizedVisibleCount = Math.max(0, visibleCount);
  return {
    visibleItems: items.slice(0, normalizedVisibleCount),
    hiddenCount: Math.max(0, totalCount - Math.min(items.length, normalizedVisibleCount)),
  };
}

export function visibleSidebarTaskGroupCountForItem<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  visibleCount: number = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT
): number | null {
  const index = items.findIndex(predicate);
  return index >= visibleCount ? index + 1 : null;
}
