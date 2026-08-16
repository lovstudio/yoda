import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PendingAction, RunState, RunStateEvent } from '@shared/events/agent-run-state';
import { isAgentSessionRunningStatus } from '@shared/events/agentEvents';
import { log } from '@main/lib/logger';
import { clearInterruptMarker, hasInterruptMarker } from './interrupt-marker';

type ClaudeSessionStatus = 'busy' | 'idle' | 'waiting';

export interface ClaudeSessionActivity {
  pid: number | null;
  sessionId: string;
  cwd: string | null;
  status: ClaudeSessionStatus;
  waitingFor: string | null;
  updatedAt: number | null;
  /** When the CLI process behind this record started. */
  startedAt: number | null;
}

export interface ClaudeSessionActivityWatcher {
  stop(): void;
}

export interface ClaudeSessionActivityContext {
  cwd: string;
  conversationId: string;
  /** Local PTY process id. Claude activity sessionId is not always Yoda's conversation id. */
  processPid?: number;
  /** Test seam; production defaults to ~/.claude. */
  claudeHomeDir?: string;
  /** Test seam for the short interrupt-marker settle window. */
  idleSettleMs?: number;
  /** Test seam for how often a running status is re-checked against the record. */
  reconcileIntervalMs?: number;
  /** Test seam for how settled a record must be before it overrules the reducer. */
  reconcileMinIdleAgeMs?: number;
}

export type ClaudeSessionActivityDispatch = (event: RunStateEvent) => void;

/** Run state this conversation currently holds, for reconciling divergence. */
export type ClaudeSessionActivityStateReader = () => RunState;

const READY_POLL_INTERVAL_MS = 1_000;
const READY_POLL_MAX_MS = 5 * 60_000;
const IDLE_SETTLE_MS = 250;
const STALE_ACTIVITY_GRACE_MS = 5_000;
const RECONCILE_INTERVAL_MS = 3_000;
/**
 * How long an idle record must have been sitting before it may overrule a
 * running status. Claude rewrites the record within milliseconds of a turn
 * starting, so anything older than this is a settled process rather than one
 * that has yet to report the work it just picked up.
 */
const RECONCILE_MIN_IDLE_AGE_MS = 2_000;
const PID_FILE_RE = /^\d+\.json$/;
const SESSION_STATUSES = new Set(['busy', 'idle', 'waiting']);

/**
 * Watches Claude Code's process activity files (`~/.claude/sessions/<pid>.json`).
 *
 * The PID-keyed activity record is Claude's direct process-state signal. It is
 * the sole source used here for `busy` / `waiting` / `idle`; transcripts remain
 * session artifacts and are not read for live status inference.
 *
 * `getState` reports the run state this conversation currently holds. The record
 * is edge-triggered — only a *change* to it produces an event — so without a view
 * of the reducer an idle record and a running status can disagree indefinitely.
 */
export function watchClaudeSessionActivity(
  ctx: ClaudeSessionActivityContext,
  dispatch: ClaudeSessionActivityDispatch,
  getState: ClaudeSessionActivityStateReader
): ClaudeSessionActivityWatcher {
  return new ClaudeSessionActivityTailer(ctx, dispatch, getState);
}

export function parseClaudeSessionActivity(raw: string): ClaudeSessionActivity | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.sessionId !== 'string') return null;
  if (typeof rec.status !== 'string' || !SESSION_STATUSES.has(rec.status)) return null;
  return {
    pid: typeof rec.pid === 'number' ? rec.pid : null,
    sessionId: rec.sessionId,
    cwd: typeof rec.cwd === 'string' ? rec.cwd : null,
    status: rec.status as ClaudeSessionStatus,
    waitingFor: typeof rec.waitingFor === 'string' ? rec.waitingFor : null,
    updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : null,
    startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : null,
  };
}

/**
 * Whether an `idle` record is admissible evidence against a run state that was
 * set at `runStateAt`.
 *
 * Claude writes its status about a second after the process starts, so a CLI
 * sitting at its boot prompt is indistinguishable — by status alone — from one
 * that just finished a turn. A process that started *after* the run state was
 * set was never there for the turn that status describes, so its idle prompt
 * says nothing about it. Starting a session is a consequence of the user opening
 * the task, so honouring that read would tie run state to being looked at.
 *
 * A turn whose process really was replaced mid-flight is reported by the exit
 * path, which knows the transport died and can say so as an interruption.
 */
export function idleActivitySettlesRunState(
  activity: Pick<ClaudeSessionActivity, 'status' | 'startedAt'>,
  runStateAt: number
): boolean {
  if (activity.status !== 'idle') return false;
  return activity.startedAt === null || activity.startedAt <= runStateAt;
}

export async function getClaudeSessionActivity({
  cwd,
  conversationId,
  processPid,
  claudeHomeDir,
}: {
  cwd?: string;
  conversationId: string;
  processPid?: number;
  claudeHomeDir?: string;
}): Promise<ClaudeSessionActivity | null> {
  const sessionsDir = join(claudeHomeDir ?? join(homedir(), '.claude'), 'sessions');
  return findMatchingActivity({ sessionsDir, cwd, conversationId, processPid, minUpdatedAt: null });
}

class ClaudeSessionActivityTailer implements ClaudeSessionActivityWatcher {
  private readonly claudeHomeDir: string;
  private readonly sessionsDir: string;
  private readonly idleSettleMs: number;
  private readonly reconcileIntervalMs: number;
  private readonly minIdleAgeMs: number;
  private readonly minUpdatedAt = Date.now() - STALE_ACTIVITY_GRACE_MS;
  private readonly readyDeadline = Date.now() + READY_POLL_MAX_MS;
  private watcher: FSWatcher | undefined;
  private readyTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private awaitingInputObserved = false;
  private reading = false;
  private pendingRead = false;
  private stopped = false;
  private reconcileTimer: NodeJS.Timeout | undefined;
  private lastActivity: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'> | null =
    null;

  constructor(
    private readonly ctx: ClaudeSessionActivityContext,
    private readonly dispatch: ClaudeSessionActivityDispatch,
    private readonly getState: ClaudeSessionActivityStateReader
  ) {
    this.claudeHomeDir = ctx.claudeHomeDir ?? join(homedir(), '.claude');
    this.sessionsDir = join(this.claudeHomeDir, 'sessions');
    this.idleSettleMs = ctx.idleSettleMs ?? IDLE_SETTLE_MS;
    this.reconcileIntervalMs = ctx.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS;
    this.minIdleAgeMs = ctx.reconcileMinIdleAgeMs ?? RECONCILE_MIN_IDLE_AGE_MS;
    this.waitForDirectory();
  }

  stop(): void {
    this.stopped = true;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    try {
      this.watcher?.close();
    } catch {}
    this.watcher = undefined;
  }

  private waitForDirectory(): void {
    if (this.stopped) return;
    stat(this.sessionsDir)
      .then((stats) => {
        if (!stats.isDirectory()) return;
        this.attach();
      })
      .catch(() => {
        if (this.stopped || Date.now() > this.readyDeadline) return;
        this.readyTimer = setTimeout(() => this.waitForDirectory(), READY_POLL_INTERVAL_MS);
      });
  }

  private attach(): void {
    if (this.stopped) return;
    try {
      this.watcher = watch(this.sessionsDir, () => this.scheduleRead());
      this.watcher.on('error', (err) => {
        log.warn('ClaudeSessionActivitySource: watch error', {
          sessionsDir: this.sessionsDir,
          error: String(err),
        });
      });
    } catch (err) {
      log.warn('ClaudeSessionActivitySource: failed to attach watcher', {
        sessionsDir: this.sessionsDir,
        error: String(err),
      });
      return;
    }
    this.reconcileTimer = setInterval(() => {
      void this.reconcileRunningStatus().catch((err) => {
        log.warn('ClaudeSessionActivitySource: reconcile error', {
          conversationId: this.ctx.conversationId,
          error: String(err),
        });
      });
    }, this.reconcileIntervalMs);
    this.reconcileTimer.unref?.();
    this.scheduleRead();
  }

  private scheduleRead(): void {
    if (this.stopped) return;
    if (this.reading) {
      this.pendingRead = true;
      return;
    }
    this.reading = true;
    void this.inspect()
      .catch((err) => {
        log.warn('ClaudeSessionActivitySource: read error', {
          sessionsDir: this.sessionsDir,
          conversationId: this.ctx.conversationId,
          error: String(err),
        });
      })
      .finally(() => {
        this.reading = false;
        if (this.pendingRead && !this.stopped) {
          this.pendingRead = false;
          this.scheduleRead();
        }
      });
  }

  private async inspect(): Promise<void> {
    const activity = await findMatchingActivity({
      sessionsDir: this.sessionsDir,
      cwd: this.ctx.cwd,
      conversationId: this.ctx.conversationId,
      processPid: this.ctx.processPid,
      minUpdatedAt: this.minUpdatedAt,
    });
    if (!activity || this.stopped) return;
    if (this.lastActivity && sameActivity(this.lastActivity, activity)) return;

    const previous = this.lastActivity;
    this.lastActivity = {
      status: activity.status,
      waitingFor: activity.waitingFor,
      updatedAt: activity.updatedAt,
    };

    if (activity.status === 'waiting') {
      this.awaitingInputObserved = true;
      this.dispatch({
        kind: 'awaiting-input',
        at: Date.now(),
        pendingAction: pendingActionForWaitingFor(activity.waitingFor),
      });
      return;
    }

    if (activity.status === 'busy' && previous?.status !== 'busy') {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      clearInterruptMarker(this.ctx.conversationId);
      const force = this.awaitingInputObserved || previous?.status === 'waiting';
      this.awaitingInputObserved = false;
      this.dispatch({
        kind: 'turn-started',
        at: Date.now(),
        force,
      });
      return;
    }

    if (activity.status === 'idle' && previous?.status !== 'idle') {
      this.awaitingInputObserved = false;
      // A fresh tailer has no baseline, and Claude writes `idle` about a second
      // after its process starts — so a first read of `idle` is equally
      // consistent with a settled turn and with a CLI that has only just booted
      // to its prompt. Attaching a watcher is a consequence of the user opening
      // the task, so publishing a verdict from that first read would make run
      // state depend on being looked at. Seed the baseline and let the next
      // transition, or the reconciler below, speak with evidence.
      if (previous) this.scheduleIdle(previous.status, activity.updatedAt);
    }
  }

  /**
   * Re-check a running status against the record, on a timer.
   *
   * Everything above is edge-triggered: it only speaks when the payload it reads
   * *changes*, and Claude stops rewriting the record once its process settles. So
   * a `working` / `awaiting-input` the record never confirmed — a settle dropped
   * across a transport swap, a hook or a renderer mirror that fired without a
   * matching resolution — has nothing left to contradict it, and the session
   * stays pinned at "running" until the user's next prompt.
   *
   * An idle record from the process that was running when the status was set is
   * positive evidence that the CLI is neither processing nor blocked on the
   * user, so it may settle a running status on its own. Nothing is inferred from
   * a *missing* record, nor from one belonging to a process that started later:
   * absence of a transport is not absence of an agent, and a conversation whose
   * process is simply gone is already handled by the exit path.
   */
  private async reconcileRunningStatus(): Promise<void> {
    // A pending settle already owns this transition; let it land.
    if (this.stopped || this.idleTimer) return;
    const state = this.getState();
    if (!isAgentSessionRunningStatus(state.status)) return;

    const settledBefore = Date.now() - this.minIdleAgeMs;
    // Both clocks must be settled. The record because Claude rewrites it within
    // milliseconds of picking up work, so a young `idle` may just not have caught
    // up yet; the status because a submit is mirrored optimistically and would
    // otherwise be cancelled before the CLI ever reported the turn.
    if (state.updatedAt > settledBefore) return;

    const activity = await getClaudeSessionActivity({
      cwd: this.ctx.cwd,
      conversationId: this.ctx.conversationId,
      processPid: this.ctx.processPid,
      claudeHomeDir: this.claudeHomeDir,
    }).catch(() => null);
    if (this.stopped || !activity) return;
    // An idle record only counts when the process behind it was already running
    // when this status was set; a newly resumed CLI is at its boot prompt.
    if (!idleActivitySettlesRunState(activity, state.updatedAt)) return;
    if (activity.updatedAt === null || activity.updatedAt > settledBefore) return;

    this.awaitingInputObserved = false;
    this.lastActivity = {
      status: activity.status,
      waitingFor: activity.waitingFor,
      updatedAt: activity.updatedAt,
    };
    // Only an interrupt marker can claim the turn was cut short. Without one the
    // CLI finished while a stale prompt was still on screen; reporting that as an
    // interruption would invent an outcome the user never caused.
    this.dispatch({
      kind: hasInterruptMarker(this.ctx.conversationId) ? 'turn-interrupted' : 'turn-completed',
      at: Date.now(),
    });
  }

  private scheduleIdle(previousStatus: ClaudeSessionStatus, updatedAt: number | null): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.stopped || this.lastActivity?.status !== 'idle') return;
      if (this.lastActivity.updatedAt !== updatedAt) return;
      const interrupted =
        previousStatus === 'waiting' || hasInterruptMarker(this.ctx.conversationId);
      this.dispatch({
        kind: interrupted ? 'turn-interrupted' : 'turn-completed',
        at: Date.now(),
      });
    }, this.idleSettleMs);
  }
}

async function findMatchingActivity({
  sessionsDir,
  cwd,
  conversationId,
  processPid,
  minUpdatedAt,
}: {
  sessionsDir: string;
  cwd?: string;
  conversationId: string;
  processPid?: number;
  minUpdatedAt: number | null;
}): Promise<ClaudeSessionActivity | null> {
  if (processPid !== undefined) {
    const exactRaw = await readFile(join(sessionsDir, `${processPid}.json`), 'utf8').catch(
      () => undefined
    );
    const exact = exactRaw ? parseClaudeSessionActivity(exactRaw) : null;
    if (
      exact?.pid === processPid &&
      (minUpdatedAt === null || exact.updatedAt === null || exact.updatedAt >= minUpdatedAt)
    ) {
      return exact;
    }
  }

  let files: string[];
  try {
    files = await readdir(sessionsDir);
  } catch {
    return null;
  }

  const activities = await Promise.all(
    files
      .filter((file) => PID_FILE_RE.test(file))
      .map(async (file) => {
        const raw = await readFile(join(sessionsDir, file), 'utf8').catch(() => undefined);
        return raw ? parseClaudeSessionActivity(raw) : null;
      })
  );
  const candidates = activities
    .filter((activity): activity is ClaudeSessionActivity => {
      if (!activity) return false;
      if (minUpdatedAt !== null && activity.updatedAt !== null && activity.updatedAt < minUpdatedAt)
        return false;
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  // The direct PID path above is the fast path. Keep this fallback for clients
  // that write a wrapper PID in the PTY while the activity payload exposes the
  // child process PID.
  if (processPid !== undefined) {
    const pidMatch = candidates.find((activity) => activity.pid === processPid);
    if (pidMatch) return pidMatch;
  }

  return (
    candidates.find(
      (activity) =>
        activity.sessionId === conversationId &&
        (cwd === undefined || activity.cwd === null || activity.cwd === cwd)
    ) ?? null
  );
}

function sameActivity(
  previous: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'>,
  next: Pick<ClaudeSessionActivity, 'status' | 'waitingFor' | 'updatedAt'>
): boolean {
  return (
    previous.status === next.status &&
    previous.waitingFor === next.waitingFor &&
    previous.updatedAt === next.updatedAt
  );
}

function pendingActionForWaitingFor(waitingFor: string | null): PendingAction {
  if (/\b(AskUserQuestion|ExitPlanMode|question|elicitation)\b/i.test(waitingFor ?? '')) {
    return {
      notificationType: 'elicitation_dialog',
      toolName: waitingFor ?? undefined,
      actionDescription: waitingFor ?? undefined,
    };
  }
  if (/(approve|permission)/i.test(waitingFor ?? '')) {
    return {
      notificationType: 'permission_prompt',
      toolName: waitingFor ?? undefined,
      actionDescription: waitingFor ?? undefined,
    };
  }
  return {
    notificationType: 'idle_prompt',
    actionDescription: waitingFor ?? undefined,
  };
}
