import { countRunningBackgroundJobs, type BackgroundJob } from '@shared/agent-background-jobs';
import {
  initialRunState,
  reduceRunState,
  type PendingAction,
  type RunState,
  type RunStateEvent,
} from '@shared/events/agent-run-state';
import {
  agentEventChannel,
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  type AgentEvent,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
import { isAppFocused, maybeShowNotification } from '@main/core/agent-hooks/notification';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { clearInterruptMarker } from './interrupt-marker';

export type AgentSessionKey = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

type RuntimeStateListener = (state: RunState) => void;

function keyFor({ projectId, taskId, conversationId }: AgentSessionKey): string {
  return `${projectId}\0${taskId}\0${conversationId}`;
}

function samePendingAction(a: PendingAction | null, b: PendingAction | null): boolean {
  return (
    a?.notificationType === b?.notificationType &&
    a?.toolName === b?.toolName &&
    a?.actionDescription === b?.actionDescription
  );
}

/**
 * Translate a legacy `AgentEvent` (hook / classifier) into a reducer event.
 * The classifier is a best-effort heuristic source; the app-server turn stream
 * (Phase 2) feeds the same reducer with deterministic `turn-*` events.
 */
function eventFor(event: AgentEvent, at: number): RunStateEvent | null {
  if (event.type === 'stop') return { kind: 'turn-completed', at };
  if (event.type === 'error') return { kind: 'turn-failed', at };
  if (event.type === 'prompt-submit') {
    // UserPromptSubmit hook — the user confirmed a new turn.
    return { kind: 'turn-started', at, force: true };
  }
  if (event.type === 'awaiting-input-resolved') {
    // The interactive tool was answered — resume working.
    return { kind: 'turn-started', at, force: true };
  }
  if (event.type === 'awaiting-input') {
    // Interactive tool (AskUserQuestion / ExitPlanMode) blocking on the user.
    const pendingAction: PendingAction = {
      notificationType: 'elicitation_dialog',
      toolName: event.payload.title,
      actionDescription: event.payload.message ?? event.payload.title,
    };
    return { kind: 'awaiting-input', at, pendingAction };
  }
  if (event.type === 'notification') {
    const notificationType = event.payload.notificationType;
    if (!notificationType) return null;
    const pendingAction: PendingAction = {
      notificationType,
      toolName: event.payload.title,
      actionDescription: event.payload.message,
    };
    return { kind: 'awaiting-input', at, pendingAction };
  }
  return null;
}

/**
 * Map a renderer-mirrored status into a reducer event. The renderer applies
 * optimistic predictions (e.g. `working` on submit) and mirrors them here; the
 * reducer is the single authority that resolves conflicts.
 */
function eventForRendererStatus(
  status: AgentSessionRuntimeStatus,
  at: number,
  pendingAction?: PendingAction | null
): RunStateEvent | null {
  switch (status) {
    case 'working':
      return { kind: 'turn-started', at, force: true };
    case 'completed':
      return { kind: 'turn-completed', at };
    case 'error':
      return { kind: 'turn-failed', at };
    case 'idle':
      return { kind: 'watchdog-idle', at };
    case 'awaiting-input':
      // The mounted renderer can detect an interactive prompt before the
      // selected durable monitor catches up. Only accept it when the renderer
      // preserved the notification subtype/context needed by the reducer.
      return pendingAction ? { kind: 'awaiting-input', at, pendingAction } : null;
    default:
      return null;
  }
}

/**
 * Backstop for heuristic sessions that never received an authoritative run
 * state source. Deterministic Claude/Codex sources are exempt because a valid
 * tool call may run silently for longer than this threshold.
 */
const WATCHDOG_STALE_MS = 30 * 60_000;
const WATCHDOG_SWEEP_INTERVAL_MS = 60_000;

type Entry = {
  session: AgentSessionKey;
  state: RunState;
  watchdogProtected: boolean;
  /** Provider-owned evidence exists for the currently running turn. */
  providerTurnConfirmed: boolean;
  /**
   * Detached jobs this session still owns. Independent of `state`: a settled
   * turn can legitimately have live jobs, which is the whole point of tracking
   * them separately (see `shared/agent-background-jobs.ts`).
   */
  backgroundJobs: BackgroundJob[];
};

const AUTHORITATIVE_RUN_STATE_SOURCES = new Set([
  'codex-rollout',
  'claude-transcript',
  'claude-session-activity',
]);

const AUTHORITATIVE_HOOK_TURN_SOURCES = new Set([
  'hook:prompt-submit',
  'hook:awaiting-input-resolved',
]);

function sourceConfirmsRunningTurn(source: string, event: RunStateEvent): boolean {
  if (AUTHORITATIVE_RUN_STATE_SOURCES.has(source)) {
    // A provider-owned awaiting-input verdict also proves that its enclosing
    // turn exists. This matters when a cold tail scan lands directly on an
    // unresolved tool without replaying its earlier turn-start row.
    return event.kind === 'turn-started' || event.kind === 'awaiting-input';
  }
  return event.kind === 'turn-started' && AUTHORITATIVE_HOOK_TURN_SOURCES.has(source);
}

function notificationEventForRuntimeState(
  session: AgentSessionKey,
  state: RunState,
  at: number
): AgentEvent | null {
  if (state.status === 'completed') {
    return {
      type: 'stop',
      source: 'runtime',
      ...session,
      timestamp: at,
      payload: {},
    };
  }

  const pendingAction = state.pendingAction;
  if (state.status !== 'awaiting-input' || !pendingAction) return null;

  return {
    type:
      pendingAction.notificationType === 'permission_prompt' ? 'notification' : 'awaiting-input',
    source: 'runtime',
    ...session,
    timestamp: at,
    payload: {
      notificationType: pendingAction.notificationType,
      title: pendingAction.toolName,
      message: pendingAction.actionDescription,
    },
  };
}

class AgentSessionRuntimeStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<RuntimeStateListener>>();
  private offRendererStatusChanged: (() => void) | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  initialize(): void {
    if (this.offRendererStatusChanged) return;
    this.offRendererStatusChanged = events.on(agentSessionStatusChangedChannel, (event) => {
      const reducerEvent = eventForRendererStatus(event.status, Date.now(), event.pendingAction);
      if (!reducerEvent) return;
      this.dispatch(event, reducerEvent, `renderer:${event.status}`);
    });
    this.watchdogTimer = setInterval(() => this.sweepStale(), WATCHDOG_SWEEP_INTERVAL_MS);
    this.watchdogTimer.unref?.();
  }

  dispose(): void {
    this.offRendererStatusChanged?.();
    this.offRendererStatusChanged = null;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.entries.clear();
    this.listeners.clear();
  }

  private sweepStale(): void {
    const now = Date.now();
    for (const { session, state, watchdogProtected } of this.entries.values()) {
      if (state.status !== 'working' && state.status !== 'awaiting-input') continue;
      if (watchdogProtected) continue;
      if (now - state.updatedAt < WATCHDOG_STALE_MS) continue;
      this.dispatch(session, { kind: 'watchdog-idle', at: now }, 'watchdog');
    }
  }

  /**
   * The single authoritative write path. Every status change folds through the
   * reducer and is logged here, so there is exactly one place to reason about
   * transitions and exactly one place to debug them.
   */
  dispatch(
    session: AgentSessionKey,
    event: RunStateEvent,
    source: string,
    options: { providerTurnConfirmed?: boolean } = {}
  ): RunState {
    // A deterministic new turn is the first durable signal after an interrupt
    // marker. Clear it here so Codex/Claude truth sources can resume working
    // even when the prompt-submit hook was missed.
    if (event.kind === 'turn-started') clearInterruptMarker(session.conversationId);
    const key = keyFor(session);
    const previousEntry = this.entries.get(key);
    const prev = previousEntry?.state ?? initialRunState();
    const next = reduceRunState(prev, event);
    const remainsRunning =
      isAgentSessionRunningStatus(prev.status) && isAgentSessionRunningStatus(next.status);
    const watchdogProtected =
      isAgentSessionRunningStatus(next.status) &&
      (AUTHORITATIVE_RUN_STATE_SOURCES.has(source) ||
        (remainsRunning && previousEntry?.watchdogProtected === true));
    const providerTurnConfirmed = !isAgentSessionRunningStatus(next.status)
      ? false
      : options.providerTurnConfirmed !== undefined
        ? options.providerTurnConfirmed
        : sourceConfirmsRunningTurn(source, event)
          ? true
          : event.kind === 'turn-started'
            ? false
            : (previousEntry?.providerTurnConfirmed ?? false);
    // Detached jobs outlive turn transitions by definition, so they survive
    // every event EXCEPT the CLI process going away: background shells are its
    // children and die with it, and a dead CLI will never write their
    // completion notification. Without this the panel would keep showing
    // phantom jobs — the same class of bug as a zombie `working` status.
    const backgroundJobs =
      event.kind === 'process-exited' ? [] : (previousEntry?.backgroundJobs ?? []);
    this.entries.set(key, {
      session,
      state: next,
      watchdogProtected,
      providerTurnConfirmed,
      backgroundJobs,
    });
    const statusChanged = prev.status !== next.status;
    const pendingActionChanged = !samePendingAction(prev.pendingAction, next.pendingAction);
    const providerTurnConfirmedChanged =
      (previousEntry?.providerTurnConfirmed ?? false) !== providerTurnConfirmed;
    // A terminal status survives `process-exited` unchanged, so the clearing
    // above would otherwise never be broadcast and every surface would keep a
    // phantom background count.
    const backgroundJobsChanged =
      countRunningBackgroundJobs(previousEntry?.backgroundJobs ?? []) !==
      countRunningBackgroundJobs(backgroundJobs);
    if (
      statusChanged ||
      pendingActionChanged ||
      providerTurnConfirmedChanged ||
      backgroundJobsChanged
    ) {
      if (statusChanged) {
        log.debug('AgentRunState transition', {
          conversationId: session.conversationId,
          from: prev.status,
          to: next.status,
          event: event.kind,
          source,
        });
      }
      // Publish every canonical transition, including renderer-originated
      // predictions. The mounted ConversationStore already changed locally, but
      // the mount-independent AgentRuntimeStore is a separate renderer store and
      // only observes main-process broadcasts. Re-applying the same status to the
      // ConversationStore uses emit:false, so this round-trip cannot loop.
      this.publishState(session, next, providerTurnConfirmed);
      if (
        AUTHORITATIVE_RUN_STATE_SOURCES.has(source) &&
        ((statusChanged && next.status === 'completed') ||
          (next.status === 'awaiting-input' && (statusChanged || pendingActionChanged)))
      ) {
        const notificationEvent = notificationEventForRuntimeState(session, next, event.at);
        if (notificationEvent) {
          const appFocused = isAppFocused();
          void maybeShowNotification(notificationEvent, appFocused);
          events.emit(agentEventChannel, { event: notificationEvent, appFocused });
        }
      }
    }
    return next;
  }

  /** Directly seed a status (used at session spawn). */
  setStatus(
    session: AgentSessionKey,
    status: AgentSessionRuntimeStatus,
    options: { providerTurnConfirmed?: boolean } = {}
  ): void {
    const at = Date.now();
    const event = eventForRendererStatus(status, at);
    if (event) {
      this.dispatch(session, event, `seed:${status}`, options);
      return;
    }
    // idle/awaiting-input seed: set baseline directly via initial state.
    const key = keyFor(session);
    const previousEntry = this.entries.get(key);
    const previous = previousEntry?.state;
    const state = initialRunState(status, at);
    const providerTurnConfirmed = isAgentSessionRunningStatus(status)
      ? (options.providerTurnConfirmed ?? previousEntry?.providerTurnConfirmed ?? false)
      : false;
    this.entries.set(key, {
      session,
      state,
      watchdogProtected: false,
      providerTurnConfirmed,
      backgroundJobs: previousEntry?.backgroundJobs ?? [],
    });
    if (
      !previous ||
      previous.status !== state.status ||
      (previousEntry?.providerTurnConfirmed ?? false) !== providerTurnConfirmed
    ) {
      this.publishState(session, state, providerTurnConfirmed);
    }
  }

  /**
   * Record the session's detached jobs (background shells, monitors, async
   * sub-agents).
   *
   * Publishes directly instead of going through {@link dispatch}: this is not a
   * status transition, and `dispatch`'s publish gate only fires on a changed
   * status / pendingAction / provider fence, so a pure count change would be
   * swallowed. Only a changed running-count is published — job bookkeeping that
   * leaves the count alone is invisible to every status surface.
   */
  setBackgroundJobs(session: AgentSessionKey, jobs: BackgroundJob[]): void {
    const key = keyFor(session);
    const entry = this.entries.get(key);
    const previousCount = countRunningBackgroundJobs(entry?.backgroundJobs ?? []);
    const nextCount = countRunningBackgroundJobs(jobs);
    if (!entry) {
      // No turn has been observed yet; seed a baseline so the jobs are not lost.
      this.entries.set(key, {
        session,
        state: initialRunState(),
        watchdogProtected: false,
        providerTurnConfirmed: false,
        backgroundJobs: jobs,
      });
    } else {
      this.entries.set(key, { ...entry, backgroundJobs: jobs });
    }
    if (previousCount === nextCount) return;
    log.debug('AgentRunState background jobs changed', {
      conversationId: session.conversationId,
      from: previousCount,
      to: nextCount,
    });
    const published = this.entries.get(key);
    this.publishState(
      session,
      published?.state ?? initialRunState(),
      published?.providerTurnConfirmed ?? false
    );
  }

  getBackgroundJobs(session: AgentSessionKey): BackgroundJob[] {
    return this.entries.get(keyFor(session))?.backgroundJobs ?? [];
  }

  /** Confirm an already-running turn without manufacturing a status transition. */
  setProviderTurnConfirmed(session: AgentSessionKey, confirmed: boolean): void {
    const key = keyFor(session);
    const entry = this.entries.get(key);
    if (!entry || !isAgentSessionRunningStatus(entry.state.status)) return;
    if (entry.providerTurnConfirmed === confirmed) return;
    const next = { ...entry, providerTurnConfirmed: confirmed };
    this.entries.set(key, next);
    this.publishState(session, next.state, confirmed);
  }

  setFromAgentEvent(event: AgentEvent): void {
    // A confirmed new turn invalidates any pending interrupt marker, so the
    // stateless deriveStatus can't gate the fresh `working` as stale.
    if (event.type === 'prompt-submit') clearInterruptMarker(event.conversationId);
    const reducerEvent = eventFor(event, event.timestamp || Date.now());
    if (!reducerEvent) return;
    this.dispatch(event, reducerEvent, `${event.source ?? 'agent'}:${event.type}`);
  }

  remove(session: AgentSessionKey): void {
    const key = keyFor(session);
    const previous = this.entries.get(key)?.state;
    this.entries.delete(key);
    if (previous && isAgentSessionRunningStatus(previous.status)) {
      this.publishState(session, initialRunState('idle', Date.now()), false);
    }
  }

  isRunning(session: AgentSessionKey): boolean {
    return isAgentSessionRunningStatus(this.getStatus(session));
  }

  getStatus(session: AgentSessionKey): AgentSessionRuntimeStatus {
    return this.entries.get(keyFor(session))?.state.status ?? 'idle';
  }

  getState(session: AgentSessionKey): RunState {
    return this.entries.get(keyFor(session))?.state ?? initialRunState();
  }

  isProviderTurnConfirmed(session: AgentSessionKey): boolean {
    return this.entries.get(keyFor(session))?.providerTurnConfirmed ?? false;
  }

  /**
   * Force the current status + provider fence across IPC for renderer cold hydration.
   *
   * A session this process never dispatched has no state to force. Publishing
   * `initialRunState()` for it would not be a snapshot but an invention: an
   * authoritative `idle` that erases a terminal status the renderer holds
   * legitimately — a `completed` derived from the tmux marker + transcript on
   * cold load, which this process's memory never saw. The status-only RPC
   * return value already carries the derived verdict for that case.
   */
  publishSnapshot(session: AgentSessionKey): void {
    const entry = this.entries.get(keyFor(session));
    if (!entry) return;
    this.publishState(session, entry.state, entry.providerTurnConfirmed);
  }

  /** Snapshot of every tracked session's current status, for renderer cold-load. */
  getAllStatuses(): Array<AgentSessionKey & { status: AgentSessionRuntimeStatus }> {
    const result: Array<AgentSessionKey & { status: AgentSessionRuntimeStatus }> = [];
    for (const { session, state } of this.entries.values()) {
      result.push({ ...session, status: state.status });
    }
    return result;
  }

  /** Main-process-only status subscription for services such as the mobile SSE gateway. */
  subscribe(session: AgentSessionKey, listener: RuntimeStateListener): () => void {
    const key = keyFor(session);
    const listeners = this.listeners.get(key) ?? new Set<RuntimeStateListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  private notifyListeners(session: AgentSessionKey, state: RunState): void {
    for (const listener of this.listeners.get(keyFor(session)) ?? []) {
      try {
        listener(state);
      } catch (error) {
        log.warn('AgentRunState listener failed', {
          conversationId: session.conversationId,
          error: String(error),
        });
      }
    }
  }

  /** Keep renderer mirrors and main-process subscribers on one canonical state. */
  private publishState(
    session: AgentSessionKey,
    state: RunState,
    providerTurnConfirmed: boolean
  ): void {
    // Read the count here rather than threading it through every caller: each
    // publish path writes its entry first, and a removed session correctly
    // reports zero.
    const key = keyFor(session);
    events.emit(agentSessionStatusChangedChannel, {
      projectId: session.projectId,
      taskId: session.taskId,
      conversationId: session.conversationId,
      status: state.status,
      pendingAction: state.pendingAction,
      providerTurnConfirmed,
      backgroundJobCount: countRunningBackgroundJobs(this.entries.get(key)?.backgroundJobs ?? []),
    });
    this.notifyListeners(session, state);
  }
}

export const agentSessionRuntimeStore = new AgentSessionRuntimeStore();
