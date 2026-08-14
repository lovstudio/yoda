import type { SessionOpenPerformanceContext } from '@shared/session-open-performance';

type TaskOpenStageDetails = Record<string, boolean | number | string | null | undefined>;

type TaskOpenVisibilityState = DocumentVisibilityState | 'unavailable';

type TaskOpenTrace = {
  contextId: string;
  projectId: string;
  taskId: string;
  startedAt: number;
  startedAtEpochMs: number;
  lastMarkedAt: number;
  hiddenDurationMs: number;
  hiddenStartedAt: number | null;
  hiddenDurationAtLastMarkMs: number;
  visibilityDocument: Document | null;
  visibilityListener: (() => void) | null;
  visibilityStateAtClick: TaskOpenVisibilityState;
  stages: Set<string>;
};

let traceSequence = 0;
let activeTrace: TaskOpenTrace | null = null;

function elapsed(trace: TaskOpenTrace, now: number): number {
  return Math.round((now - trace.startedAt) * 10) / 10;
}

function segment(trace: TaskOpenTrace, now: number): number {
  return Math.round((now - trace.lastMarkedAt) * 10) / 10;
}

function roundDuration(durationMs: number): number {
  return Math.round(Math.max(0, durationMs) * 10) / 10;
}

function getVisibilityDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

function getVisibilityState(visibilityDocument: Document | null): TaskOpenVisibilityState {
  return visibilityDocument?.visibilityState ?? 'unavailable';
}

function isHidden(state: TaskOpenVisibilityState): boolean {
  return state === 'hidden';
}

function currentHiddenDuration(trace: TaskOpenTrace, now: number): number {
  const activeHiddenDuration =
    trace.hiddenStartedAt === null ? 0 : Math.max(0, now - trace.hiddenStartedAt);
  return roundDuration(trace.hiddenDurationMs + activeHiddenDuration);
}

function visibilityDetails(trace: TaskOpenTrace, now: number) {
  const elapsedMs = elapsed(trace, now);
  const hiddenDurationMs = currentHiddenDuration(trace, now);
  return {
    visibilityStateAtClick: trace.visibilityStateAtClick,
    visibilityState: getVisibilityState(trace.visibilityDocument),
    hiddenDurationMs,
    visibleElapsedMs: roundDuration(elapsedMs - hiddenDurationMs),
  };
}

function updateTraceVisibility(trace: TaskOpenTrace, now: number): void {
  const hidden = isHidden(getVisibilityState(trace.visibilityDocument));
  if (hidden && trace.hiddenStartedAt === null) {
    trace.hiddenStartedAt = now;
    return;
  }
  if (!hidden && trace.hiddenStartedAt !== null) {
    trace.hiddenDurationMs += Math.max(0, now - trace.hiddenStartedAt);
    trace.hiddenStartedAt = null;
  }
}

function stopVisibilityTracking(trace: TaskOpenTrace, now: number): void {
  updateTraceVisibility(trace, now);
  if (trace.hiddenStartedAt !== null) {
    trace.hiddenDurationMs += Math.max(0, now - trace.hiddenStartedAt);
    trace.hiddenStartedAt = null;
  }
  if (trace.visibilityDocument && trace.visibilityListener) {
    trace.visibilityDocument.removeEventListener('visibilitychange', trace.visibilityListener);
  }
  trace.visibilityListener = null;
}

function cancelTrace(trace: TaskOpenTrace, now: number, details?: TaskOpenStageDetails): void {
  if (trace.stages.has('cancelled') || trace.stages.has('painted')) return;
  stopVisibilityTracking(trace, now);
  trace.stages.add('cancelled');
  console.log('[DEBUG][task-open] cancelled:', {
    context_id: trace.contextId,
    projectId: trace.projectId,
    taskId: trace.taskId,
    segmentMs: segment(trace, now),
    elapsedMs: elapsed(trace, now),
    ...details,
    ...visibilityDetails(trace, now),
  });
}

function matchingTrace(projectId: string, taskId: string): TaskOpenTrace | null {
  if (!activeTrace) return null;
  return activeTrace.projectId === projectId && activeTrace.taskId === taskId ? activeTrace : null;
}

export function beginTaskOpenTrace(projectId: string, taskId: string): string {
  const now = performance.now();
  const startedAtEpochMs = Date.now();
  const contextId = `task-open-${startedAtEpochMs.toString(36)}-${++traceSequence}`;
  if (activeTrace) cancelTrace(activeTrace, now, { reason: 'superseded' });

  const visibilityDocument = getVisibilityDocument();
  const visibilityStateAtClick = getVisibilityState(visibilityDocument);
  const trace: TaskOpenTrace = {
    contextId,
    projectId,
    taskId,
    startedAt: now,
    startedAtEpochMs,
    lastMarkedAt: now,
    hiddenDurationMs: 0,
    hiddenStartedAt: isHidden(visibilityStateAtClick) ? now : null,
    hiddenDurationAtLastMarkMs: 0,
    visibilityDocument,
    visibilityListener: null,
    visibilityStateAtClick,
    stages: new Set(['click']),
  };
  if (visibilityDocument) {
    trace.visibilityListener = () => updateTraceVisibility(trace, performance.now());
    visibilityDocument.addEventListener('visibilitychange', trace.visibilityListener);
  }
  activeTrace = trace;
  console.log('[DEBUG][task-open] click:', {
    context_id: contextId,
    projectId,
    taskId,
    elapsedMs: 0,
    ...visibilityDetails(trace, now),
  });
  return contextId;
}

/** Stable cross-process correlation captured once at the start of a task open. */
export function getTaskOpenPerformanceContext(
  projectId: string,
  taskId: string
): SessionOpenPerformanceContext | undefined {
  const trace = matchingTrace(projectId, taskId);
  if (!trace) return undefined;
  return {
    contextId: trace.contextId,
    clickAtEpochMs: trace.startedAtEpochMs,
  };
}

export function markTaskOpenTrace(
  projectId: string,
  taskId: string,
  stage: string,
  details?: TaskOpenStageDetails
): void {
  const trace = matchingTrace(projectId, taskId);
  if (!trace || trace.stages.has(stage)) return;

  const now = performance.now();
  const hiddenDurationMs = currentHiddenDuration(trace, now);
  trace.stages.add(stage);
  console.log(`[DEBUG][task-open] ${stage}:`, {
    context_id: trace.contextId,
    projectId,
    taskId,
    segmentMs: segment(trace, now),
    elapsedMs: elapsed(trace, now),
    ...details,
    ...visibilityDetails(trace, now),
    visibleSegmentMs: roundDuration(
      now - trace.lastMarkedAt - (hiddenDurationMs - trace.hiddenDurationAtLastMarkMs)
    ),
  });
  trace.lastMarkedAt = now;
  trace.hiddenDurationAtLastMarkMs = hiddenDurationMs;
}

export function cancelTaskOpenTrace(
  projectId: string,
  taskId: string,
  details?: TaskOpenStageDetails,
  expectedContextId?: string
): void {
  const trace = matchingTrace(projectId, taskId);
  if (!trace || (expectedContextId !== undefined && trace.contextId !== expectedContextId)) return;

  const now = performance.now();
  cancelTrace(trace, now, details);
  if (activeTrace === trace) activeTrace = null;
}

export function completeTaskOpenTrace(
  projectId: string,
  taskId: string,
  details?: TaskOpenStageDetails
): void {
  const trace = matchingTrace(projectId, taskId);
  if (!trace || trace.stages.has('painted')) return;

  markTaskOpenTrace(projectId, taskId, 'painted', details);
  stopVisibilityTracking(trace, performance.now());
  if (activeTrace === trace) activeTrace = null;
}
