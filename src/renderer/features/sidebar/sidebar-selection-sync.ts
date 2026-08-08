import type { SidebarSelectionRevealRequest } from './sidebar-store';

const SIDEBAR_LOCATE_HIGHLIGHT_MS = 1600;
const locateHighlightTimers = new WeakMap<HTMLElement, number>();

interface SidebarRouteSelection {
  key: string;
  projectId: string;
  taskId?: string;
}

export interface SidebarSelectionTarget extends SidebarRouteSelection {
  requestId?: number;
  shouldFocus: boolean;
}

export function resolveSidebarSelectionTarget(
  routeSelection: SidebarRouteSelection | null,
  revealRequest: SidebarSelectionRevealRequest | null
): SidebarSelectionTarget | null {
  if (revealRequest) {
    return {
      key: `reveal:${revealRequest.requestId}`,
      projectId: revealRequest.projectId,
      requestId: revealRequest.requestId,
      shouldFocus: true,
      ...(revealRequest.taskId ? { taskId: revealRequest.taskId } : {}),
    };
  }
  return routeSelection ? { ...routeSelection, shouldFocus: false } : null;
}

export function shouldSuppressSidebarRouteScroll(
  selectionKey: string | null,
  requestId: number | undefined,
  suppressedRouteKey: string | null
): boolean {
  return requestId === undefined && selectionKey !== null && selectionKey === suppressedRouteKey;
}

export function shouldRevealSidebarSelection(
  selectionKey: string,
  lastRevealedSelectionKey: string | null
): boolean {
  return selectionKey !== lastRevealedSelectionKey;
}

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
  if (!root) return null;
  const row = findSidebarSelectionRow(root, projectId, taskId);
  if (!row) return null;
  if (focus) {
    scrollSidebarSelectionRow(root, row);
    row.focus({ preventScroll: true });
    highlightSidebarSelectionRow(row);
  } else {
    row.scrollIntoView({ block: 'nearest' });
  }
  return row;
}

function scrollSidebarSelectionRow(root: HTMLElement, row: HTMLElement): void {
  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const centeredOffset = Math.max(0, (root.clientHeight - row.offsetHeight) / 2);
  const top = Math.max(0, root.scrollTop + rowRect.top - rootRect.top - centeredOffset);
  root.scrollTo({ top, behavior: 'smooth' });
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
