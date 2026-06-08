import {
  isAttentionNotification,
  type AgentSessionRuntimeStatus,
  type NotificationType,
} from './agentEvents';

/**
 * Single authoritative run-state reducer for agent sessions.
 *
 * Mirrors the design of Codex's `agent_status_from_event` (a pure
 * `(Event) -> Status` fold) and Claude Code's single `notifySessionStateChanged`
 * choke point. Every status transition in Yoda must go through `reduceRunState`
 * so there is exactly one place where the rules live and one place to log.
 *
 * State is intentionally small and serializable so it can live in the
 * main-process authoritative store and be mirrored to the renderer.
 */

export type RunStatus = AgentSessionRuntimeStatus;

/**
 * Context attached to an `awaiting-input` transition, so the UI can render
 * "waiting on you: Editing src/foo.ts" instead of a bare "needs attention".
 * (Phase 3 populates `toolName`/`actionDescription`; Phase 1 may leave them
 * undefined.)
 */
export interface PendingAction {
  notificationType: NotificationType;
  toolName?: string;
  actionDescription?: string;
}

export interface RunState {
  status: RunStatus;
  /**
   * Whether the user has observed the current terminal/attention status.
   * `idle` and `working` are always considered seen; terminal/attention
   * states stay unseen until explicitly marked.
   */
  seen: boolean;
  pendingAction: PendingAction | null;
  /** Wall-clock ms of the last user-confirmed `working` transition (`force`). */
  lastForceWorkingAt: number;
  /** Wall-clock ms of the last transition — used by the watchdog. */
  updatedAt: number;
}

export type RunStateEvent =
  /** Deterministic: a turn began (app-server `turn/started`, or user submit). */
  | { kind: 'turn-started'; at: number; force?: boolean }
  /** Deterministic: a turn finished cleanly (app-server `turn/completed`). */
  | { kind: 'turn-completed'; at: number }
  /** Deterministic: a turn failed (app-server `turn/completed` status=Failed). */
  | { kind: 'turn-failed'; at: number }
  /**
   * Deterministic: a turn was interrupted — NOT terminal. The agent may receive
   * more input. Mirrors Codex `AgentStatus::Interrupted` ("may receive more input").
   */
  | { kind: 'turn-interrupted'; at: number }
  /** The agent is waiting on the user (permission / elicitation / idle prompt). */
  | { kind: 'awaiting-input'; at: number; pendingAction: PendingAction }
  /** The PTY process exited — hard stop, clears any running state. */
  | { kind: 'process-exited'; at: number }
  /** Watchdog forced a return to idle after no signal for too long. */
  | { kind: 'watchdog-idle'; at: number }
  /** User observed the current status (clears `seen=false`). */
  | { kind: 'mark-seen'; at: number };

/**
 * Suppress classifier-derived awaiting-input echoes that fire within this window
 * after a user-confirmed `working` transition. Classifiers scan the tail of PTY
 * output for permission/confirm keywords and easily re-trigger on the echoed
 * prompt right after the user answers, which would otherwise immediately flip
 * the status back to awaiting-input.
 */
export const POST_SUBMIT_NOTIFICATION_GRACE_MS = 3000;

export function initialRunState(status: RunStatus = 'idle', at = 0): RunState {
  return {
    status,
    seen: status === 'idle' || status === 'working',
    pendingAction: null,
    lastForceWorkingAt: status === 'working' ? at : 0,
    updatedAt: at,
  };
}

function isRunningStatus(status: RunStatus): boolean {
  return status === 'working' || status === 'awaiting-input';
}

/**
 * The single authoritative transition function. Pure and idempotent: feeding
 * the same event to the same state always yields the same result, and replaying
 * a terminal event does not resurrect a running state.
 */
export function reduceRunState(state: RunState, event: RunStateEvent): RunState {
  switch (event.kind) {
    case 'turn-started': {
      // Honour the same suppression the old `setWorking` had: a non-forced
      // start that arrives while we're already showing a permission prompt
      // should not clear that prompt (the user still has to answer it).
      if (
        !event.force &&
        state.status === 'awaiting-input' &&
        state.pendingAction?.notificationType === 'permission_prompt'
      ) {
        return state;
      }
      return {
        status: 'working',
        seen: true,
        pendingAction: null,
        lastForceWorkingAt: event.force ? event.at : state.lastForceWorkingAt,
        updatedAt: event.at,
      };
    }

    case 'awaiting-input': {
      if (!isAttentionNotification(event.pendingAction.notificationType)) {
        return state;
      }
      // Ignore classifier-driven echoes that fire right after the user submitted
      // a reply — the agent is still working, not waiting again.
      if (
        state.status === 'working' &&
        event.at - state.lastForceWorkingAt < POST_SUBMIT_NOTIFICATION_GRACE_MS
      ) {
        return state;
      }
      return {
        ...state,
        status: 'awaiting-input',
        seen: false,
        pendingAction: event.pendingAction,
        updatedAt: event.at,
      };
    }

    case 'turn-completed':
      return {
        ...state,
        status: 'completed',
        seen: false,
        pendingAction: null,
        updatedAt: event.at,
      };

    case 'turn-failed':
      return {
        ...state,
        status: 'error',
        seen: false,
        pendingAction: null,
        updatedAt: event.at,
      };

    case 'turn-interrupted':
      // Non-terminal: a turn was cut short but the session can keep going.
      // Drop to idle so the spinner stops, but don't mark error/completed.
      return {
        ...state,
        status: 'idle',
        seen: true,
        pendingAction: null,
        updatedAt: event.at,
      };

    case 'process-exited':
      // Hard stop. Only clears running states; a session that already reached a
      // terminal status (completed/error) keeps it so the user still sees it.
      if (!isRunningStatus(state.status)) {
        return { ...state, updatedAt: event.at };
      }
      return {
        ...state,
        status: 'idle',
        seen: true,
        pendingAction: null,
        updatedAt: event.at,
      };

    case 'watchdog-idle':
      if (!isRunningStatus(state.status)) {
        return state;
      }
      return {
        ...state,
        status: 'idle',
        seen: true,
        pendingAction: null,
        updatedAt: event.at,
      };

    case 'mark-seen':
      if (state.seen) return state;
      return { ...state, seen: true, updatedAt: event.at };

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
