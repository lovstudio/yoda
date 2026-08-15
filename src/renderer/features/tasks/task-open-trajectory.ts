/**
 * Retains task-open stage marks so the workspace bar can render where a single
 * open actually spent its time. The DevTools console already receives every
 * mark, but a console line cannot answer "which participant was busy and who
 * was waiting on whom" — the profiler needs the marks kept, ordered, and
 * correlated across the renderer/main split by the shared task-open context id.
 *
 * This module stores raw marks only. Lane assignment, per-lane durations, and
 * idle-gap detection are derived at read time in `task-open-trajectory-lanes`,
 * so a late-arriving main-process mark cannot bake a wrong duration into the
 * store.
 */

export type TaskOpenTrajectorySource = 'renderer' | 'main';

export type TaskOpenTrajectoryOutcome = 'open' | 'painted' | 'cancelled';

export type TaskOpenTrajectoryDetails = Record<
  string,
  boolean | number | string | null | undefined
>;

export type TaskOpenTrajectoryStep = {
  stage: string;
  source: TaskOpenTrajectorySource;
  /** Milliseconds between the click and this mark. */
  atMs: number;
  details: TaskOpenTrajectoryDetails;
};

export type TaskOpenTrajectory = {
  contextId: string;
  projectId: string;
  taskId: string;
  startedAtEpochMs: number;
  outcome: TaskOpenTrajectoryOutcome;
  /** Elapsed milliseconds at the terminating stage; null while still open. */
  totalMs: number | null;
  steps: TaskOpenTrajectoryStep[];
};

/** Bounded so a long session cannot grow this into a leak. */
const MAX_TRAJECTORIES = 24;

let trajectories: TaskOpenTrajectory[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function find(contextId: string): TaskOpenTrajectory | undefined {
  return trajectories.find((trajectory) => trajectory.contextId === contextId);
}

/**
 * Replaces the whole array so `useSyncExternalStore` sees a new reference. The
 * mutated trajectory is cloned for the same reason; React bails out of a render
 * when the snapshot is referentially equal even if a nested array changed.
 */
function commit(next: TaskOpenTrajectory): void {
  trajectories = trajectories.map((trajectory) =>
    trajectory.contextId === next.contextId ? next : trajectory
  );
  publish();
}

export function beginTaskOpenTrajectory(
  contextId: string,
  projectId: string,
  taskId: string,
  startedAtEpochMs: number
): void {
  const started: TaskOpenTrajectory = {
    contextId,
    projectId,
    taskId,
    startedAtEpochMs,
    outcome: 'open',
    totalMs: null,
    steps: [{ stage: 'click', source: 'renderer', atMs: 0, details: {} }],
  };
  trajectories = [started, ...trajectories].slice(0, MAX_TRAJECTORIES);
  publish();
}

export function recordTaskOpenTrajectoryStep(
  contextId: string,
  step: {
    stage: string;
    source: TaskOpenTrajectorySource;
    atMs: number;
    details?: TaskOpenTrajectoryDetails;
  }
): void {
  const trajectory = find(contextId);
  if (!trajectory) return;

  // Main and renderer marks interleave, and a main event can be delivered after
  // a later renderer mark. Order by elapsed time, not arrival.
  const steps = [
    ...trajectory.steps,
    {
      stage: step.stage,
      source: step.source,
      atMs: Math.max(0, step.atMs),
      details: step.details ?? {},
    },
  ].sort((a, b) => a.atMs - b.atMs);

  commit({ ...trajectory, steps });
}

export function finishTaskOpenTrajectory(
  contextId: string,
  outcome: Exclude<TaskOpenTrajectoryOutcome, 'open'>,
  totalMs: number
): void {
  const trajectory = find(contextId);
  if (!trajectory || trajectory.outcome !== 'open') return;
  commit({ ...trajectory, outcome, totalMs: Math.max(0, totalMs) });
}

export function clearTaskOpenTrajectories(): void {
  trajectories = [];
  publish();
}

export function getTaskOpenTrajectories(): TaskOpenTrajectory[] {
  return trajectories;
}

export function subscribeTaskOpenTrajectories(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
