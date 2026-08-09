import { stripAnsi } from '@main/core/agent-hooks/classifiers/base';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { markInterrupted } from './interrupt-marker';

/**
 * Opportunistic Esc-interrupt detection for Claude sessions, from PTY output.
 *
 * When the user interrupts a turn, the CC TUI immediately renders an
 * interruption prompt. Claude has used both
 * `Interrupted · What should Claude do instead?` and
 * `Conversation interrupted – tell Claude ...`. The authoritative process
 * signal is the session activity file (`~/.claude/sessions/<pid>.json`); this
 * sniffer preserves the more specific interrupted-vs-completed distinction. It
 * observes the session's rendered effect — not the user's keystrokes, which are
 * decoupled from what the session actually did.
 *
 * False-positive surface: a full-screen redraw (e.g. resize) can re-emit an
 * old "Interrupted" line while a new turn is working. Cheap to tolerate — the
 * status drops to idle and the next `busy` activity transition re-asserts
 * `working`; the cooldown keeps repeated redraws from thrashing.
 */
const INTERRUPT_UI_PATTERNS: readonly RegExp[] = [
  /Interrupted\s*·\s*What should Claude do instead\?/i,
  /Conversation\s+interrupted\s*[–—-]\s*(?:tell|what should)\s+Claude\b/i,
];

/** Keep enough stripped tail to span a marker split across output chunks. */
const TAIL_BUFFER_CHARS = 400;
const COOLDOWN_MS = 5_000;

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

/** Returns an onData handler; attach to a Claude session's PTY. */
export function createClaudeInterruptSniffer(session: AgentSessionKey): (chunk: string) => void {
  let tail = '';
  let lastFiredAt = 0;

  return (chunk: string) => {
    tail = (tail + stripAnsi(chunk)).slice(-TAIL_BUFFER_CHARS);
    if (Date.now() - lastFiredAt < COOLDOWN_MS) return;
    if (!INTERRUPT_UI_PATTERNS.some((pattern) => pattern.test(tail))) return;
    lastFiredAt = Date.now();
    tail = '';
    if (agentSessionRuntimeStore.getStatus(session) !== 'working') return;
    log.debug('ClaudeInterruptSniffer: interrupt UI detected, clearing working', session);
    // Preserve the interrupt marker for other reconciliation paths.
    markInterrupted(session.conversationId);
    agentSessionRuntimeStore.dispatch(
      session,
      { kind: 'turn-interrupted', at: Date.now() },
      'interrupt-sniffer'
    );
  };
}
