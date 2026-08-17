export const STANDALONE_KANBAN_WINDOW_TARGET_PARAM = 'standaloneKanbanWindowTarget';

/** One board card: the live agent session of a real, persisted task. */
export type StandaloneKanbanPane = { projectId: string; taskId: string };

/**
 * A detached window that lines up the live agent sessions side by side, ranked
 * the way the kanban sidebar ranks them. Each card renders only the session's
 * TUI — no task chrome — so the window is a pure "watch the agents work" surface.
 * The tasks stay untouched in the main workspace; closing the window changes
 * nothing about them.
 *
 * The pane list is resolved by the main window (the one that owns the kanban
 * ordering) and refreshed over `standaloneKanbanPanesChangedChannel`, so an
 * empty list is a legitimate target: the window opens on its empty state and
 * fills in as sessions start.
 */
export type StandaloneKanbanWindowTarget = { panes: StandaloneKanbanPane[] };

/**
 * Card width floor. A TUI narrower than this rewraps its own output, so cards
 * keep this width and the board scrolls horizontally instead of shrinking them.
 */
export const STANDALONE_KANBAN_MIN_PANE_WIDTH = 420;

/** Window floor: two cards plus their gutters, and enough rows to be usable. */
export const STANDALONE_KANBAN_MIN_WINDOW_WIDTH = 720;
export const STANDALONE_KANBAN_MIN_WINDOW_HEIGHT = 480;

export const STANDALONE_KANBAN_MAX_PANE_OPTIONS = [2, 3, 4, 6, 8] as const;
export type StandaloneKanbanMaxPanes = (typeof STANDALONE_KANBAN_MAX_PANE_OPTIONS)[number];
export const DEFAULT_STANDALONE_KANBAN_MAX_PANES: StandaloneKanbanMaxPanes = 4;

export function parseStandaloneKanbanMaxPanes(
  value: unknown
): StandaloneKanbanMaxPanes | undefined {
  return STANDALONE_KANBAN_MAX_PANE_OPTIONS.find((option) => option === value);
}

export function encodeStandaloneKanbanWindowTarget(target: StandaloneKanbanWindowTarget): string {
  return JSON.stringify(target);
}

export function parseStandaloneKanbanWindowTargetSearch(
  search: string
): StandaloneKanbanWindowTarget | null {
  return parseStandaloneKanbanWindowTargetParam(
    new URLSearchParams(search).get(STANDALONE_KANBAN_WINDOW_TARGET_PARAM)
  );
}

export function parseStandaloneKanbanWindowTargetParam(
  raw: string | null | undefined
): StandaloneKanbanWindowTarget | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStandaloneKanbanWindowTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isStandaloneKanbanWindowTarget(
  value: unknown
): value is StandaloneKanbanWindowTarget {
  if (!isRecord(value)) return false;
  return Array.isArray(value.panes) && value.panes.every(isStandaloneKanbanPane);
}

function isStandaloneKanbanPane(value: unknown): value is StandaloneKanbanPane {
  return isRecord(value) && isNonEmptyString(value.projectId) && isNonEmptyString(value.taskId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
