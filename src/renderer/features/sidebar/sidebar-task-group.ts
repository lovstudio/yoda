import { DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT } from '@shared/view-state';

export type SidebarTaskGroupRowVariant = 'underProject' | 'pinned' | 'flat';

export function getSidebarTaskGroupDisclosure<T>(
  items: readonly T[],
  expanded: boolean,
  visibleLimit: number = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT
): { visibleItems: T[]; hiddenCount: number } {
  return {
    visibleItems: expanded ? [...items] : items.slice(0, visibleLimit),
    hiddenCount: Math.max(0, items.length - visibleLimit),
  };
}

export function hiddenSidebarTaskGroupItemsContain<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
  visibleLimit: number = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT
): boolean {
  return items.slice(visibleLimit).some(predicate);
}
