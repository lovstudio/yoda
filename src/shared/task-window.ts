import type { GitChangeStatus, GitObjectRef } from './git';

export const TASK_WINDOW_TARGET_PARAM = 'taskWindowTarget';
/** URL flag marking a pre-warmed task window that boots empty and waits for a target. */
export const TASK_WINDOW_WARM_PARAM = 'taskWindowWarm';
export const TASK_WINDOW_DRAG_MIME = 'application/x-yoda-task-window';

export type TaskWindowBounds = {
  width: number;
  height: number;
  /**
   * Release point in the source (main) window's content/CSS pixel space. When
   * present, the new window is positioned so its title bar sits under this point,
   * so a torn-out tab spawns where the user dropped it. Converted to screen
   * coordinates in the main process.
   */
  origin?: { x: number; y: number };
};

export type TaskWindowTabTarget =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'room-member'; memberId: string }
  | { kind: 'file'; path: string }
  | {
      kind: 'diff';
      path: string;
      diffGroup: 'disk' | 'staged' | 'git' | 'pr';
      originalRef: GitObjectRef;
      modifiedRef?: GitObjectRef;
      prNumber?: number;
      status?: GitChangeStatus;
    };

export type TaskWindowTarget = {
  projectId: string;
  taskId: string;
  tab: TaskWindowTabTarget;
  bounds?: TaskWindowBounds;
};

export type TaskWindowDragPayload = {
  sourceWindowId: number;
  target: TaskWindowTarget;
};

export function encodeTaskWindowTarget(target: TaskWindowTarget): string {
  return JSON.stringify(target);
}

export function parseTaskWindowTargetSearch(search: string): TaskWindowTarget | null {
  return parseTaskWindowTargetParam(new URLSearchParams(search).get(TASK_WINDOW_TARGET_PARAM));
}

export function parseTaskWindowTargetParam(
  raw: string | null | undefined
): TaskWindowTarget | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isTaskWindowTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isTaskWindowTarget(value: unknown): value is TaskWindowTarget {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.taskId) &&
    isTaskWindowTabTarget(value.tab) &&
    (value.bounds === undefined || isTaskWindowBounds(value.bounds))
  );
}

export function encodeTaskWindowDragPayload(payload: TaskWindowDragPayload): string {
  return JSON.stringify(payload);
}

export function parseTaskWindowDragPayload(
  raw: string | null | undefined
): TaskWindowDragPayload | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isTaskWindowDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isTaskWindowDragPayload(value: unknown): value is TaskWindowDragPayload {
  if (!isRecord(value)) return false;
  const sourceWindowId = value.sourceWindowId;
  return (
    Number.isInteger(sourceWindowId) &&
    typeof sourceWindowId === 'number' &&
    sourceWindowId > 0 &&
    isTaskWindowTarget(value.target)
  );
}

function isTaskWindowTabTarget(value: unknown): value is TaskWindowTabTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'conversation':
      return isNonEmptyString(value.conversationId);
    case 'room-member':
      return isNonEmptyString(value.memberId);
    case 'file':
      return isNonEmptyString(value.path);
    case 'diff':
      return (
        isNonEmptyString(value.path) &&
        isDiffGroup(value.diffGroup) &&
        isGitObjectRef(value.originalRef) &&
        (value.modifiedRef === undefined || isGitObjectRef(value.modifiedRef)) &&
        (value.prNumber === undefined || Number.isInteger(value.prNumber)) &&
        (value.status === undefined || isGitChangeStatus(value.status))
      );
    default:
      return false;
  }
}

function isTaskWindowBounds(value: unknown): value is TaskWindowBounds {
  if (!isRecord(value)) return false;
  const width = value.width;
  const height = value.height;
  return (
    Number.isInteger(width) &&
    typeof width === 'number' &&
    width > 0 &&
    Number.isInteger(height) &&
    typeof height === 'number' &&
    height > 0 &&
    (value.origin === undefined || isPoint(value.origin))
  );
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return (
    isRecord(value) &&
    Number.isInteger(value.x) &&
    typeof value.x === 'number' &&
    Number.isInteger(value.y) &&
    typeof value.y === 'number'
  );
}

function isDiffGroup(
  value: unknown
): value is Extract<TaskWindowTabTarget, { kind: 'diff' }>['diffGroup'] {
  return value === 'disk' || value === 'staged' || value === 'git' || value === 'pr';
}

function isGitChangeStatus(value: unknown): value is GitChangeStatus {
  return (
    value === 'added' ||
    value === 'modified' ||
    value === 'deleted' ||
    value === 'renamed' ||
    value === 'conflicted'
  );
}

function isGitObjectRef(value: unknown): value is GitObjectRef {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;

  switch (value.kind) {
    case 'commit':
      return isNonEmptyString(value.sha);
    case 'tag':
      return isNonEmptyString(value.name);
    case 'branch':
      return isBranch(value.branch);
    default:
      return false;
  }
}

function isBranch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'local') {
    return isNonEmptyString(value.branch) && (value.remote === undefined || isRemote(value.remote));
  }
  if (value.type === 'remote') {
    return isNonEmptyString(value.branch) && isRemote(value.remote);
  }
  return false;
}

function isRemote(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.name) && isNonEmptyString(value.url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
