/** Moves `activeId` to the slot `overId` currently occupies. */
export function reorderIds(ids: string[], activeId: string, overId: string): string[] {
  const fromIndex = ids.indexOf(activeId);
  const toIndex = ids.indexOf(overId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return ids;
  const next = ids.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Reorders the visible subset while leaving hidden entries in their slots. */
export function reorderIdsInVisibleList(
  allIds: string[],
  visibleIds: string[],
  activeId: string,
  overId: string
): string[] {
  const reorderedVisibleIds = reorderIds(visibleIds, activeId, overId);
  if (reorderedVisibleIds === visibleIds) return allIds;
  const visible = new Set(visibleIds);
  let visibleIndex = 0;
  return allIds.map((id) => {
    if (!visible.has(id)) return id;
    const next = reorderedVisibleIds[visibleIndex];
    visibleIndex += 1;
    return next ?? id;
  });
}
