export const COMPARISON_WINDOW_TARGET_PARAM = 'comparisonWindowTarget';

export type ComparisonPane = { projectId: string; taskId: string };

export type ComparisonLayout = { kind: 'columns' | 'rows'; count: number };

/**
 * A detached window that tiles several tasks side by side for comparison. Each
 * pane renders a self-contained task view; the tasks are real, persisted tasks
 * that also live in their project's sidebar, so closing this window leaves them
 * intact in the main workspace.
 */
export type ComparisonWindowTarget = {
  panes: ComparisonPane[];
  layout: ComparisonLayout;
};

export function encodeComparisonWindowTarget(target: ComparisonWindowTarget): string {
  return JSON.stringify(target);
}

export function parseComparisonWindowTargetSearch(search: string): ComparisonWindowTarget | null {
  return parseComparisonWindowTargetParam(
    new URLSearchParams(search).get(COMPARISON_WINDOW_TARGET_PARAM)
  );
}

export function parseComparisonWindowTargetParam(
  raw: string | null | undefined
): ComparisonWindowTarget | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isComparisonWindowTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isComparisonWindowTarget(value: unknown): value is ComparisonWindowTarget {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.panes) &&
    value.panes.length > 0 &&
    value.panes.every(isComparisonPane) &&
    isComparisonLayout(value.layout)
  );
}

function isComparisonPane(value: unknown): value is ComparisonPane {
  return isRecord(value) && isNonEmptyString(value.projectId) && isNonEmptyString(value.taskId);
}

function isComparisonLayout(value: unknown): value is ComparisonLayout {
  if (!isRecord(value)) return false;
  return (
    (value.kind === 'columns' || value.kind === 'rows') &&
    Number.isInteger(value.count) &&
    typeof value.count === 'number' &&
    value.count > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
