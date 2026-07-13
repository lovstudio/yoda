import {
  initialRunState,
  reduceRunState,
  type PendingAction,
  type RunState,
  type RunStateEvent,
} from '@shared/events/agent-run-state';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
  type AgentEvent,
  type AgentSessionRuntimeStatus,
} from '@shared/events/agentEvents';
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
  at: number
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
      // The renderer should not be the source of awaiting-input (it lacks the
      // notification type); ignore — hook/classifier/app-server own this.
      return null;
    default:
      return null;
  }
}

/**
 * Backstop: a session stuck in a running state with no transition for this long
 * is overwhelmingly a missed terminal event (e.g. codex crashed mid-turn without
 * writing `turn_aborted`, or the rollout never bound), not a genuinely long turn.
 * Force it to idle so the spinner stops. Generous on purpose — deterministic
 * sources (rollout tailer, hooks) handle the normal case.
 */
const WATCHDOG_STALE_MS = 30 * 60_000;
const WATCHDOG_SWEEP_INTERVAL_MS = 60_000;

type Entry = { session: AgentSessionKey; state: RunState };

class AgentSessionRuntimeStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<RuntimeStateListener>>();
  private offRendererStatusChanged: (() => void) | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  initialize(): void {
    if (this.offRendererStatusChanged) return;
    this.offRendererStatusChanged = events.on(agentSessionStatusChangedChannel, (event) => {
      const reducerEvent = eventForRendererStatus(event.status, Date.now());
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
    for (const { session, state } of this.entries.values()) {
      if (state.status !== 'working' && state.status !== 'awaiting-input') continue;
      if (now - state.updatedAt < WATCHDOG_STALE_MS) continue;
      this.dispatch(session, { kind: 'watchdog-idle', at: now }, 'watchdog');
    }
  }

  /**
   * The single authoritative write path. Every status change folds through the
   * reducer and is logged here, so there is exactly one place to reason about
   * transitions and exactly one place to debug them.
   */
  dispatch(session: AgentSessionKey, event: RunStateEvent, source: string): RunState {
    const key = keyFor(session);
    const prev = this.entries.get(key)?.state ?? initialRunState();
    const next = reduceRunState(prev, event);
    this.entries.set(key, { session, state: next });
    const statusChanged = prev.status !== next.status;
    const pendingActionChanged = !samePendingAction(prev.pendingAction, next.pendingAction);
    if (statusChanged || pendingActionChanged) {
      if (statusChanged) {
        log.debug('AgentRunState transition', {
          conversationId: session.conversationId,
          from: prev.status,
          to: next.status,
          event: event.kind,
          source,
        });
      }
      // Broadcast deterministic transitions (e.g. from the codex rollout tailer)
      // to the renderer. Renderer-originated changes already update the renderer
      // store directly and are echoed here, so only forward changes that did NOT
      // originate from the renderer to avoid a redundant round-trip.
      if (!source.startsWith('renderer:')) {
        events.emit(agentSessionStatusChangedChannel, {
          projectId: session.projectId,
          taskId: session.taskId,
          conversationId: session.conversationId,
          status: next.status,
          pendingAction: next.pendingAction,
        });
      }
      this.notifyListeners(session, next);
    }
    return next;
  }

  /** Directly seed a status (used at session spawn). */
  setStatus(session: AgentSessionKey, status: AgentSessionRuntimeStatus): void {
    const at = Date.now();
    const event = eventForRendererStatus(status, at);
    if (event) {
      this.dispatch(session, event, `seed:${status}`);
      return;
    }
    // idle/awaiting-input seed: set baseline directly via initial state.
    const key = keyFor(session);
    const previous = this.entries.get(key)?.state;
    const state = initialRunState(status, at);
    this.entries.set(key, { session, state });
    if (!previous || previous.status !== state.status) this.notifyListeners(session, state);
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
      this.notifyListeners(session, initialRunState('idle', Date.now()));
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
}

export const agentSessionRuntimeStore = new AgentSessionRuntimeStore();
