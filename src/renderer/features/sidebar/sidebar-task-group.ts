export const SIDEBAR_TASK_GROUP_VISIBLE_LIMIT = 5;

export type SidebarTaskGroupRowVariant = 'underProject' | 'pinned' | 'flat';

export function getSidebarTaskGroupDisclosure<T>(
  items: readonly T[],
  expanded: boolean
): { visibleItems: T[]; hiddenCount: number } {
  return {
    visibleItems: expanded ? [...items] : items.slice(0, SIDEBAR_TASK_GROUP_VISIBLE_LIMIT),
    hiddenCount: Math.max(0, items.length - SIDEBAR_TASK_GROUP_VISIBLE_LIMIT),
  };
}

export function hiddenSidebarTaskGroupItemsContain<T>(
  items: readonly T[],
  predicate: (item: T) => boolean
): boolean {
  return items.slice(SIDEBAR_TASK_GROUP_VISIBLE_LIMIT).some(predicate);
}
