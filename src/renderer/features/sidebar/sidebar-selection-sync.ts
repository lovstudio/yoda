export function findSidebarSelectionRow(
  root: HTMLElement | null,
  projectId: string,
  taskId?: string
): HTMLElement | null {
  if (!root) return null;
  const entity = taskId ? 'task' : 'project';
  const candidates = root.querySelectorAll<HTMLElement>(`[data-sidebar-entity="${entity}"]`);
  for (const candidate of candidates) {
    if (candidate.dataset.sidebarProjectId !== projectId) continue;
    if (taskId && candidate.dataset.sidebarTaskId !== taskId) continue;
    return candidate;
  }
  return null;
}

export function revealSidebarSelectionRow(
  root: HTMLElement | null,
  projectId: string,
  taskId?: string,
  focus = false
): HTMLElement | null {
  const row = findSidebarSelectionRow(root, projectId, taskId);
  if (!row) return null;
  row.scrollIntoView({ block: 'nearest' });
  if (focus) row.focus({ preventScroll: true });
  return row;
}
