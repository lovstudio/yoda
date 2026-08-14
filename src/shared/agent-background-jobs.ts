import type { AgentSessionRuntimeStatus } from './events/agentEvents';

/**
 * Background jobs an agent CLI keeps running after its turn ends.
 *
 * Claude Code can launch a shell with `run_in_background`, a `Monitor` watch, or
 * an async sub-agent; all three outlive the turn that started them. The turn
 * itself completes normally (Stop hook fires, the transcript gets its
 * `stop_hook_summary`), so the session's run status is a truthful `completed` /
 * `idle` while real work is still in flight.
 *
 * These jobs are therefore modelled as a separate dimension rather than a sixth
 * `AgentSessionRuntimeStatus`. Folding them into `working` would attach an
 * interrupt button that cannot reach the detached process, suppress the
 * turn-completed notification, and let the PTY silence reconciler flip the
 * status back on its own.
 */

export type BackgroundJobKind =
  /** `Bash` with `run_in_background`. */
  | 'bash'
  /** `Monitor` — a long-lived watch that streams events back into the session. */
  | 'monitor'
  /** An async sub-agent (`Agent` launched in the background). */
  | 'agent';

/**
 * Terminal buckets mirror the CLI's own `<status>` vocabulary (`completed`,
 * `failed`, `killed`, `stopped`). `killed`/`stopped` collapse into `stopped`
 * because both mean "someone ended it deliberately" — rendering those as a
 * failure would put a red marker on an intentional stop.
 */
export type BackgroundJobStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface BackgroundJob {
  /** The CLI's own background task id, e.g. `b5jtgzpuh`. Unique per session. */
  taskId: string;
  kind: BackgroundJobKind;
  status: BackgroundJobStatus;
  /** The tool call's human-readable description, when it supplied one. */
  description?: string;
  /** The shell command / watch command, verbatim. */
  command?: string;
  /** Absolute path the CLI streams this job's output to. */
  outputPath?: string;
  /** Epoch ms of the tool result that launched the job. */
  startedAt: number;
  /** Epoch ms of the completion notification, once it arrives. */
  endedAt?: number;
  /** Completion summary line from the notification. */
  summary?: string;
  /** Last write to {@link outputPath}; filled in when a caller stats the file. */
  lastOutputAt?: number;
}

/**
 * What a surface actually renders for a session: the run status, plus the
 * derived `background` state for a settled turn that still owns live jobs.
 */
export type AgentDisplayStatus = AgentSessionRuntimeStatus | 'background';

export function countRunningBackgroundJobs(jobs: readonly BackgroundJob[]): number {
  let running = 0;
  for (const job of jobs) {
    if (job.status === 'running') running += 1;
  }
  return running;
}

/**
 * The single place the `background` display state is decided, so every surface
 * agrees.
 *
 * The agent's own activity outranks a side job: `working`, `awaiting-input` and
 * `error` each say something the user must wait for or act on, and must not be
 * downgraded. Only a settled turn adopts the weaker "a job is still running"
 * signal.
 */
export function deriveAgentDisplayStatus(
  status: AgentSessionRuntimeStatus,
  runningBackgroundJobCount: number
): AgentDisplayStatus {
  if (runningBackgroundJobCount <= 0) return status;
  return status === 'idle' || status === 'completed' ? 'background' : status;
}
