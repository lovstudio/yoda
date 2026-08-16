import { stripAnsi } from '@main/core/agent-hooks/classifiers/base';
import { isPtyRepainting } from '@main/core/pty/pty-repaint-window';
import { log } from '@main/lib/logger';
import { agentSessionRuntimeStore } from './agent-session-runtime';
import { markInterrupted } from './interrupt-marker';

/**
 * Opportunistic Esc-interrupt detection for agent sessions, from PTY output.
 *
 * When the user interrupts a turn, Claude Code and Codex render an interruption
 * prompt in their TUI. Claude has used both
 * `Interrupted · What should Claude do instead?` and
 * `Conversation interrupted – tell Claude ...`; Codex uses
 * `Conversation interrupted - tell the model ...`. The authoritative process
 * signal may arrive later (or, for a Codex turn interrupted while a tool is
 * running, not be written to the rollout at all); this sniffer preserves the
 * specific interrupted-vs-completed distinction. It observes the session's
 * rendered effect — not the user's keystrokes, which are decoupled from what
 * the session actually did.
 *
 * The rendered effect is only evidence when it is *new*. A tmux-backed session
 * re-emits its entire pane — scrollback included — on client attach and on
 * every client resize, so opening a working task replays whatever interruption
 * line an earlier turn left on screen. That replay used to clear the live
 * turn's `working` status and leave a marker that suppressed the transcript's
 * `working` verdict until the next user prompt. Two guards keep replays out:
 * the repaint window a resize opens, and a priming phase covering the initial
 * attach dump, which ends at the session's first quiet gap in output.
 */
const INTERRUPT_UI_PATTERNS: readonly RegExp[] = [
  /Interrupted\s*·\s*What should Claude do instead\?/i,
  /Conversation\s+interrupted\s*[–—-]\s*(?:tell\s+(?:Claude|the\s+model)|what\s+should\s+Claude)\b/i,
];

/** Keep enough stripped tail to span a marker split across output chunks. */
const TAIL_BUFFER_CHARS = 400;
const COOLDOWN_MS = 5_000;
/**
 * An attach dump arrives as one uninterrupted burst, so the first gap this long
 * means the session has settled and is rendering live output again. Turn output
 * pauses far longer than this between tokens and tool calls, so priming always
 * ends well before a user could interrupt.
 */
const PRIMING_QUIET_MS = 400;

interface AgentSessionKey {
  projectId: string;
  taskId: string;
  conversationId: string;
}

/** Returns an onData handler; attach to a Claude session's PTY. */
export function createClaudeInterruptSniffer(
  session: AgentSessionKey & { ptySessionId: string }
): (chunk: string) => void {
  const { ptySessionId, ...agentSession } = session;
  let tail = '';
  let lastFiredAt = 0;
  let lastChunkAt = 0;
  let priming = true;

  return (chunk: string) => {
    const now = Date.now();
    if (priming && lastChunkAt !== 0 && now - lastChunkAt >= PRIMING_QUIET_MS) priming = false;
    lastChunkAt = now;
    if (priming || isPtyRepainting(ptySessionId, now)) {
      tail = '';
      return;
    }
    tail = (tail + stripAnsi(chunk)).slice(-TAIL_BUFFER_CHARS);
    if (now - lastFiredAt < COOLDOWN_MS) return;
    if (!INTERRUPT_UI_PATTERNS.some((pattern) => pattern.test(tail))) return;
    lastFiredAt = now;
    tail = '';
    const status = agentSessionRuntimeStore.getStatus(agentSession);
    if (status !== 'working' && status !== 'awaiting-input') return;
    log.debug(
      'AgentInterruptSniffer: interrupt UI detected, clearing running status',
      agentSession
    );
    // Preserve the interrupt marker for other reconciliation paths.
    markInterrupted(agentSession.conversationId);
    agentSessionRuntimeStore.dispatch(
      agentSession,
      { kind: 'turn-interrupted', at: now },
      'interrupt-sniffer'
    );
  };
}
