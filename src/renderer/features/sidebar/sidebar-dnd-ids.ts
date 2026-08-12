const PINNED_DND_SOURCE_PREFIX = 'pinned::';

export function toSidebarPinnedDndId(dndId: string): string {
  return `${PINNED_DND_SOURCE_PREFIX}${dndId}`;
}

export function normalizeSidebarDndId(dndId: string): string {
  return dndId.startsWith(PINNED_DND_SOURCE_PREFIX)
    ? dndId.slice(PINNED_DND_SOURCE_PREFIX.length)
    : dndId;
}

export function isSidebarDndDropAllowed(activeDndId: string, overDndId: string): boolean {
  const activeId = normalizeSidebarDndId(activeDndId);
  const overId = normalizeSidebarDndId(overDndId);

  if (activeId.startsWith('proj::')) return overId.startsWith('proj::');
  if (!activeId.startsWith('task::')) return true;
  if (overId.startsWith('task::')) return true;
  if (!overId.startsWith('proj::')) return false;

  const sourceProjectId = activeId.split('::')[1];
  return overId !== `proj::${sourceProjectId}`;
}
