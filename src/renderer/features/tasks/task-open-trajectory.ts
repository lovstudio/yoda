/**
 * Retains task-open stage marks so the workspace bar can render a waterfall of
 * where a single open actually spent its time. The DevTools console already
 * receives every mark, but a console line cannot answer "which step was the
 * long one" — the profiler needs the marks kept, ordered, and correlated across
 * the renderer/main split by the shared task-open context id.
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
  /** Milliseconds between the click and this stage. */
  atMs: number;
  /** Milliseconds spent since the previous step of the same source. */
  durationMs: number;
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
    steps: [{ stage: 'click', source: 'renderer', atMs: 0, durationMs: 0, details: {} }],
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
  // a later renderer mark. Order by elapsed time, not arrival, and measure each
  // gap against its own process so an out-of-order delivery cannot report a
  // negative duration.
  const previousOfSource = trajectory.steps.filter((entry) => entry.source === step.source).at(-1);
  const atMs = Math.max(0, step.atMs);
  const steps = [
    ...trajectory.steps,
    {
      stage: step.stage,
      source: step.source,
      atMs,
      durationMs: Math.max(0, atMs - (previousOfSource?.atMs ?? 0)),
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

/** The gap a reader should look at first: the longest step of the open. */
export function slowestTaskOpenStep(
  trajectory: TaskOpenTrajectory
): TaskOpenTrajectoryStep | undefined {
  return trajectory.steps.reduce<TaskOpenTrajectoryStep | undefined>(
    (slowest, step) =>
      slowest === undefined || step.durationMs > slowest.durationMs ? step : slowest,
    undefined
  );
}
