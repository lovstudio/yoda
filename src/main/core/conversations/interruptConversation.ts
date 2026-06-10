import { makePtySessionId } from '@shared/ptySessionId';
import { ok } from '@shared/result';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';

/** Esc — the interrupt key of the agent TUIs (Claude Code / Codex). */
const INTERRUPT_INPUT = '\x1b';

/**
 * How long the authoritative run-state sources get to confirm the interrupt. A
 * real interrupt lands in the transcript within ~100ms (interrupt sentinel /
 * turn_aborted) and flips the status through the normal pipeline. Hitting this
 * timeout means the session was stale-working — e.g. a turn killed by an app
 * restart leaves the transcript frozen mid-turn while the resumed CLI idles at
 * the prompt, so Esc has nothing to interrupt and no terminal row ever arrives.
 */
const CONFIRM_TIMEOUT_MS = 3_000;

/**
 * Interrupt a working agent session: send Esc to its PTY and, if no
 * authoritative source confirms a status change in time, force-clear the
 * status so a stale `working` can always be dismissed by the user. If the CLI
 * was genuinely working and ignored Esc, the next transcript-derived
 * transition re-asserts `working` — the force-clear is self-correcting.
 */
export function interruptConversation(projectId: string, taskId: string, conversationId: string) {
  const session = { projectId, taskId, conversationId };
  const pty = ptySessionRegistry.get(makePtySessionId(projectId, taskId, conversationId));
  if (!pty) {
    // No live CLI — nothing to interrupt; the `working` is stale by definition.
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:no-pty'
    );
    return ok();
  }
  pty.write(INTERRUPT_INPUT);
  setTimeout(() => {
    if (agentSessionRuntimeStore.getStatus(session) !== 'working') return;
    log.debug('interruptConversation: unconfirmed after timeout, force-clearing', session);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'watchdog-idle', at: Date.now() },
      'interrupt:timeout'
    );
  }, CONFIRM_TIMEOUT_MS);
  return ok();
}
