const SIDEBAR_LOCATE_HIGHLIGHT_MS = 1600;
const locateHighlightTimers = new WeakMap<HTMLElement, number>();

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
  if (focus) {
    row.focus({ preventScroll: true });
    highlightSidebarSelectionRow(row);
  }
  return row;
}

function highlightSidebarSelectionRow(row: HTMLElement): void {
  const previousTimer = locateHighlightTimers.get(row);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);

  delete row.dataset.sidebarLocateHighlight;
  void row.offsetWidth;
  row.dataset.sidebarLocateHighlight = 'true';

  const timer = window.setTimeout(() => {
    delete row.dataset.sidebarLocateHighlight;
    locateHighlightTimers.delete(row);
  }, SIDEBAR_LOCATE_HIGHLIGHT_MS);
  locateHighlightTimers.set(row, timer);
}
