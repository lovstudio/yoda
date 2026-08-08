import { makePtySessionId } from '@shared/ptySessionId';
import { ok } from '@shared/result';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { agentSilenceReconciler } from './agent-silence-reconciler';
import { markInterrupted } from './interrupt-marker';

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

/** Esc — the interrupt key of the agent TUIs (Claude Code / Codex). */
const INTERRUPT_INPUT = '\x1b';

/**
 * How long the authoritative run-state sources get to confirm the interrupt. A
 * real interrupt lands in the selected activity/transcript/rollout source and
 * flips status through the normal pipeline. Hitting this timeout means the
 * session was stale-working, so Esc had nothing active to interrupt.
 */
const CONFIRM_TIMEOUT_MS = 3_000;

/**
 * Interrupt a working agent session: send Esc to its PTY and, if no
 * authoritative source confirms a status change in time, force-clear the
 * status so a stale `working` can always be dismissed by the user. If the CLI
 * was genuinely working and ignored Esc, the next monitor transition re-asserts
 * `working` — the force-clear is self-correcting.
 */
export function interruptConversation(projectId: string, taskId: string, conversationId: string) {
  const session = { projectId, taskId, conversationId };
  const ptySessionId = makePtySessionId(projectId, taskId, conversationId);
  const pty = ptySessionRegistry.get(ptySessionId);
  if (!pty) {
    // No live CLI — nothing to interrupt; the `working` is stale by definition.
    markInterrupted(conversationId);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:no-pty'
    );
    return ok();
  }
  // Silence can prove a heuristic session stale, but never short-circuit an
  // authoritative Claude/Codex session: a long-running tool call may be quiet
  // while still genuinely working and must receive Esc when the user asks to
  // interrupt it.
  if (agentSilenceReconciler.isAutoReconcileStale(ptySessionId)) {
    markInterrupted(conversationId);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:stale-silent'
    );
    return ok();
  }
  pty.write(INTERRUPT_INPUT);
  scheduleInterruptReconcile(session);
  return ok();
}

/**
 * After an Esc was sent (or typed), give the authoritative sources
 * {@link CONFIRM_TIMEOUT_MS} to confirm; if the session is still `working`,
 * force-clear it. Self-correcting: a genuinely working CLI that ignored the
 * Esc re-asserts `working` on its next monitor transition.
 */
function scheduleInterruptReconcile(session: AgentSessionKey): void {
  // Mark immediately so activity can distinguish busy -> idle interruption and
  // the optional transcript monitor cannot resurrect a frozen working verdict.
  markInterrupted(session.conversationId);
  setTimeout(() => {
    if (agentSessionRuntimeStore.getStatus(session) !== 'working') return;
    log.debug('interruptConversation: unconfirmed after timeout, force-clearing', session);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:timeout'
    );
  }, CONFIRM_TIMEOUT_MS);
}
