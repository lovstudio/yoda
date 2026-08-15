/**
 * One-way channel from the terminal frame-acknowledgement loop to the task-open
 * profiler.
 *
 * The frame loop lives in `lib/pty` and must not import a feature module, yet
 * its waits are exactly where a task open can sit for seconds with nobody
 * producing a mark — the dead air the swimlane profiler exists to attribute. A
 * registered sink keeps the dependency pointing outward: the profiler installs
 * itself, and the frame loop stays ignorant of who is listening.
 *
 * Before the first task open the sink is absent, which is also when there is no
 * trace to mark against; a dropped mark in that window costs nothing.
 */

export type TaskOpenFrameStage =
  /** A visible DOM host was handed to the terminal. */
  | 'frame-mount'
  /** Parked because the output subscription has not delivered its snapshot. */
  | 'frame-snapshot-wait'
  /** Parked because this generation does not yet own a complete process frame. */
  | 'frame-canonical-wait'
  /** Parked in a settlement or live-frame grace window. */
  | 'frame-quiet-wait'
  | 'frame-painted'
  /** The bounded attempt gave up; the React owner keeps its loading surface. */
  | 'frame-unavailable';

export type TaskOpenFrameDetails = Record<string, boolean | number | string | null | undefined>;

type TaskOpenFrameMarkSink = (stage: TaskOpenFrameStage, details?: TaskOpenFrameDetails) => void;

let sink: TaskOpenFrameMarkSink | null = null;

export function setTaskOpenFrameMarkSink(next: TaskOpenFrameMarkSink | null): void {
  sink = next;
}

export function markTaskOpenFrameStage(
  stage: TaskOpenFrameStage,
  details?: TaskOpenFrameDetails
): void {
  sink?.(stage, details);
}
