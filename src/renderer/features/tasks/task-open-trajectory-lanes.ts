/**
 * Turns a flat list of task-open marks into swimlanes, one per participant, and
 * flags the intervals where nobody was working.
 *
 * A single-track waterfall answers "which mark was slow"; it cannot answer "the
 * terminal was ready at 500ms but the UI only picked it up at 5.4s", which is
 * the shape of the handoff bugs this profiler exists to catch. Assigning every
 * mark to the entity that produced it makes those gaps visible as dead air
 * across all lanes at once.
 */

import type { TaskOpenTrajectory, TaskOpenTrajectoryStep } from './task-open-trajectory';

export type TaskOpenLaneId = 'ui' | 'frame' | 'open' | 'session' | 'client' | 'pty';

export type TaskOpenLaneGroupId = 'frontend' | 'backend';

/** Lane order top-to-bottom, grouped by the process the lane lives in. */
export const TASK_OPEN_LANE_GROUPS: { group: TaskOpenLaneGroupId; lanes: TaskOpenLaneId[] }[] = [
  { group: 'frontend', lanes: ['ui', 'frame', 'open'] },
  { group: 'backend', lanes: ['session', 'client', 'pty'] },
];

/**
 * Marks are named by the code that emits them, not by owner, so the mapping is
 * explicit. An unknown stage falls back to its process's orchestration lane
 * rather than being dropped — a new mark should show up misfiled, never
 * invisible.
 */
const LANE_BY_STAGE: Record<string, TaskOpenLaneId> = {
  // Renderer — the open pipeline driving the transition.
  click: 'open',
  'store-resolved': 'open',
  'task-prepared': 'open',
  'task-provisioned': 'open',
  'target-resolved': 'open',
  'target-hydrating': 'open',
  'target-hydrated': 'open',
  'canonical-frame-deferred': 'open',
  cancelled: 'open',
  // Renderer — what the user can actually see on screen.
  'loading-route-committed': 'ui',
  'route-committed': 'ui',
  'view-wrapper-committed': 'ui',
  'main-panel-committed': 'ui',
  'active-renderer-committed': 'ui',
  painted: 'ui',
  // Renderer — React's readiness to accept a frame. Separate from the loop that
  // produces one, so a backend-ready/frontend-not-listening stall reads as a
  // handoff between two lanes instead of hiding inside one.
  'verify-blocked': 'ui',
  'verify-armed': 'ui',
  'verify-retry': 'ui',
  // Keyboard focus is the UI's own handoff after the frame is up, not part of
  // producing it — filing it in the frame lane would read as the terminal still
  // drawing.
  'input-focus-wait': 'ui',
  // Renderer — the terminal's own frame-acknowledgement loop. Its waits are the
  // difference between "the backend delivered" and "the user can see it".
  'frame-mount': 'frame',
  'frame-ack-blocked': 'frame',
  'frame-snapshot-wait': 'frame',
  'frame-canonical-wait': 'frame',
  'frame-quiet-wait': 'frame',
  'frame-resync': 'frame',
  'frame-canonical-degraded': 'frame',
  // A resize is the UI's doing, not the frame loop's — filing it here would hide
  // "our own layout invalidated the frame we were waiting for" inside one lane.
  'frame-resize': 'ui',
  'frame-painted': 'frame',
  'frame-unavailable': 'frame',
  // Main — session resolution and bookkeeping.
  'resume-received': 'session',
  'inflight-joined': 'session',
  'hydration-barrier': 'session',
  'operation-lock': 'session',
  'conversation-query': 'session',
  'task-resolve': 'session',
  'permission-reconcile': 'session',
  'surface-anchor': 'session',
  'session-classified': 'session',
  'external-writer-probe': 'session',
  'resume-resolved': 'session',
  // Main — the agent client process.
  'provider-start': 'client',
  'provider-preflight': 'client',
  'provider-spawn': 'client',
  'provider-committed': 'client',
  // Main — the terminal carrying that process.
  'tmux-marker-probe': 'pty',
  'pty-registered': 'pty',
  'pty-first-output': 'pty',
  'tmux-reattach-confirm': 'pty',
};

export function laneOfStep(step: TaskOpenTrajectoryStep): TaskOpenLaneId {
  return LANE_BY_STAGE[step.stage] ?? (step.source === 'main' ? 'session' : 'open');
}

export type TaskOpenLaneSegment = {
  step: TaskOpenTrajectoryStep;
  lane: TaskOpenLaneId;
  /** Where this lane's stretch of work began — its previous mark. */
  startMs: number;
  /** Zero for a lane's first mark: there is no earlier mark to measure against. */
  durationMs: number;
  isLaneStart: boolean;
};

export type TaskOpenLaneTrack = {
  lane: TaskOpenLaneId;
  segments: TaskOpenLaneSegment[];
};

export type TaskOpenGap = {
  /** `handoff` crosses lanes — someone finished and someone else was late to react. */
  kind: 'handoff' | 'stall';
  fromLane: TaskOpenLaneId;
  toLane: TaskOpenLaneId;
  fromStage: string;
  toStage: string;
  startMs: number;
  durationMs: number;
  /**
   * How many times the preceding wait was re-entered during this interval.
   *
   * Nonzero changes the diagnosis completely: the interval was not dead air, it
   * was a loop whose condition kept being invalidated. Reporting them the same
   * way sends the reader looking for a missing wakeup that does not exist.
   */
  retries: number;
};

export type TaskOpenAnalysis = {
  spanMs: number;
  tracks: TaskOpenLaneTrack[];
  segments: TaskOpenLaneSegment[];
  gaps: TaskOpenGap[];
  slowest: TaskOpenLaneSegment | undefined;
};

/**
 * Below this an interval is scheduling noise, not a design problem. Set well
 * above a frame so a normal React commit never registers as dead air.
 */
const GAP_THRESHOLD_MS = 300;
/** Only the worst offenders are actionable; a full list would bury them. */
const MAX_REPORTED_GAPS = 3;

export function analyzeTaskOpenTrajectory(trajectory: TaskOpenTrajectory): TaskOpenAnalysis {
  const steps = [...trajectory.steps].sort((a, b) => a.atMs - b.atMs);
  const spanMs = Math.max(trajectory.totalMs ?? 0, steps.at(-1)?.atMs ?? 0, 1);

  const lastMarkByLane = new Map<TaskOpenLaneId, number>();
  const segmentsByLane = new Map<TaskOpenLaneId, TaskOpenLaneSegment[]>();
  const segments: TaskOpenLaneSegment[] = [];

  for (const step of steps) {
    const lane = laneOfStep(step);
    const previousMs = lastMarkByLane.get(lane);
    const segment: TaskOpenLaneSegment = {
      step,
      lane,
      startMs: previousMs ?? step.atMs,
      durationMs: previousMs === undefined ? 0 : Math.max(0, step.atMs - previousMs),
      isLaneStart: previousMs === undefined,
    };
    segments.push(segment);
    const laneSegments = segmentsByLane.get(lane);
    if (laneSegments) laneSegments.push(segment);
    else segmentsByLane.set(lane, [segment]);
    lastMarkByLane.set(lane, step.atMs);
  }

  const tracks: TaskOpenLaneTrack[] = [];
  for (const { lanes } of TASK_OPEN_LANE_GROUPS) {
    for (const lane of lanes) {
      const laneSegments = segmentsByLane.get(lane);
      if (laneSegments) tracks.push({ lane, segments: laneSegments });
    }
  }

  // A gap is measured against the whole timeline, not one lane: an interval only
  // counts as dead air when no participant produced a mark during it.
  const gaps: TaskOpenGap[] = [];
  for (let index = 1; index < steps.length; index++) {
    const previous = steps[index - 1];
    const next = steps[index];
    const durationMs = next.atMs - previous.atMs;
    if (durationMs < GAP_THRESHOLD_MS) continue;
    const fromLane = laneOfStep(previous);
    const toLane = laneOfStep(next);
    gaps.push({
      kind: fromLane === toLane ? 'stall' : 'handoff',
      fromLane,
      toLane,
      fromStage: previous.stage,
      toStage: next.stage,
      startMs: previous.atMs,
      durationMs,
      retries: previous.lastAtMs > previous.atMs ? previous.repeats : 0,
    });
  }
  gaps.sort((a, b) => b.durationMs - a.durationMs);

  const slowest = segments.reduce<TaskOpenLaneSegment | undefined>(
    (worst, segment) =>
      worst === undefined || segment.durationMs > worst.durationMs ? segment : worst,
    undefined
  );

  return {
    spanMs,
    tracks,
    segments,
    gaps: gaps.slice(0, MAX_REPORTED_GAPS),
    slowest: slowest && slowest.durationMs > 0 ? slowest : undefined,
  };
}
