type TaskOpenStageDetails = Record<string, boolean | number | string | null | undefined>;

type TaskOpenTrace = {
  contextId: string;
  projectId: string;
  taskId: string;
  startedAt: number;
  lastMarkedAt: number;
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

function matchingTrace(projectId: string, taskId: string): TaskOpenTrace | null {
  if (!activeTrace) return null;
  return activeTrace.projectId === projectId && activeTrace.taskId === taskId ? activeTrace : null;
}

export function beginTaskOpenTrace(projectId: string, taskId: string): string {
  const now = performance.now();
  const contextId = `task-open-${Date.now().toString(36)}-${++traceSequence}`;
  activeTrace = {
    contextId,
    projectId,
    taskId,
    startedAt: now,
    lastMarkedAt: now,
    stages: new Set(['click']),
  };
  console.log('[DEBUG][task-open] click:', {
    context_id: contextId,
    projectId,
    taskId,
    elapsedMs: 0,
  });
  return contextId;
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
  trace.stages.add(stage);
  console.log(`[DEBUG][task-open] ${stage}:`, {
    context_id: trace.contextId,
    projectId,
    taskId,
    segmentMs: segment(trace, now),
    elapsedMs: elapsed(trace, now),
    ...details,
  });
  trace.lastMarkedAt = now;
}

export function completeTaskOpenTrace(
  projectId: string,
  taskId: string,
  details?: TaskOpenStageDetails
): void {
  const trace = matchingTrace(projectId, taskId);
  if (!trace || trace.stages.has('painted')) return;

  markTaskOpenTrace(projectId, taskId, 'painted', details);
  if (activeTrace === trace) activeTrace = null;
}
