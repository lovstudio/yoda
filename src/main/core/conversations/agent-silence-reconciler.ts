import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { markInterrupted } from './interrupt-marker';

/**
 * Last-resort output-silence reconciler for heuristic agent sessions.
 *
 * Agent TUIs commonly redraw a spinner / elapsed counter while a turn is
 * running, so prolonged silence can be useful as a fallback when no
 * authoritative source exists. It is not a universal liveness invariant:
 * deterministic Claude/Codex sources may remain `working` while a long-running
 * tool produces no PTY output. Those sessions attach with `autoReconcile: false`
 * and retain silence tracking only for explicit interrupt handling.
 *
 * Automatic reconciliation catches gaps where a watcher is unavailable or the
 * process exited before another source could report a terminal transition:
 *
 *  - Esc pressed before the first assistant output: CC writes no interrupt
 *    sentinel and fires no Stop hook, so the transcript freezes in a `working`
 *    shape if the session activity watcher is unavailable.
 *  - A turn killed by an app/CLI restart: the resumed CLI idles at the prompt
 *    while the transcript still looks mid-turn.
 *
 * Deliberately NOT keystroke detection — what the user pressed is decoupled
 * from what the session actually did; silence observes the effect, not the
 * input. Self-correcting heuristic sources can re-assert `working` when output
 * resumes.
 */
const SILENCE_THRESHOLD_MS = 10_000;
const SWEEP_INTERVAL_MS = 3_000;

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

interface Entry {
  session: AgentSessionKey;
  lastOutputAt: number;
  autoReconcile: boolean;
}

interface AgentSilenceReconcilerOptions {
  /**
   * Whether prolonged silence may automatically clear a stale `working`
   * status. Disable this when the session has an authoritative run-state
   * source (for example a Claude transcript or Codex rollout tailer).
   *
   * Silence is still tracked for diagnostics; explicit interrupts must still
   * reach authoritative sessions because a quiet tool call can be genuinely
   * running.
   */
  autoReconcile?: boolean;
}

export class AgentSilenceReconciler {
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  /**
   * Track a live agent PTY. Call `noteOutput` from its onData; returns a
   * dispose function for PTY exit.
   */
  attach(
    ptySessionId: string,
    session: AgentSessionKey,
    { autoReconcile = true }: AgentSilenceReconcilerOptions = {}
  ): () => void {
    this.entries.set(ptySessionId, {
      session,
      lastOutputAt: Date.now(),
      autoReconcile,
    });
    if (!this.timer) {
      this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
      this.timer.unref?.();
    }
    return () => {
      this.entries.delete(ptySessionId);
      if (this.entries.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  noteOutput(ptySessionId: string): void {
    const entry = this.entries.get(ptySessionId);
    if (entry) entry.lastOutputAt = Date.now();
  }

  /**
   * True when the session's PTY has been silent past the threshold. This is a
   * signal for explicit interrupt handling, not by itself an authoritative
   * verdict about whether a turn is running.
   */
  isStale(ptySessionId: string): boolean {
    const entry = this.entries.get(ptySessionId);
    if (!entry) return false;
    return Date.now() - entry.lastOutputAt > SILENCE_THRESHOLD_MS;
  }

  /** True only when silence is allowed to prove this heuristic session idle. */
  isAutoReconcileStale(ptySessionId: string): boolean {
    const entry = this.entries.get(ptySessionId);
    return !!entry?.autoReconcile && this.isStale(ptySessionId);
  }

  private sweep(): void {
    const now = Date.now();
    for (const { session, lastOutputAt, autoReconcile } of this.entries.values()) {
      if (!autoReconcile) continue;
      if (now - lastOutputAt <= SILENCE_THRESHOLD_MS) continue;
      if (agentSessionRuntimeStore.getStatus(session) !== 'working') continue;
      // Don't clear a turn that JUST started and hasn't produced output yet
      // (submit → working is set before the CLI echoes anything).
      if (now - agentSessionRuntimeStore.getState(session).updatedAt <= SILENCE_THRESHOLD_MS) {
        continue;
      }
      log.debug('AgentSilenceReconciler: working but silent, clearing', session);
      // Mark first so the stateless deriveStatus / transcript tailer can't
      // resurrect the zombie `working` from the frozen transcript.
      markInterrupted(session.conversationId);
      agentSessionRuntimeStore.dispatch(
        session,
        { kind: 'watchdog-idle', at: now },
        'silence:stale'
      );
    }
  }
}

export const agentSilenceReconciler = new AgentSilenceReconciler();
