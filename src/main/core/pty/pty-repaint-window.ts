/**
 * Short-lived "this session is repainting because we asked it to" windows.
 *
 * A tmux-backed session redraws its whole pane whenever its client resizes or
 * attaches — verified at byte level: the redraw re-emits every visible row,
 * including lines written by earlier turns. Output produced that way is a copy
 * of what is already on screen, so no observer may read it as fresh activity.
 * Without this guard, opening a working task resizes its terminal, tmux
 * re-emits a previous turn's `Conversation interrupted` line, and the interrupt
 * sniffer clears a live turn's `working` status.
 *
 * Keyed by PTY session id, because the resize choke point knows only that.
 */

/** Repaints land in one burst right after SIGWINCH; this is slack, not a poll. */
const REPAINT_WINDOW_MS = 1_500;

const repaintingUntil = new Map<string, number>();

export function notePtyRepaint(sessionId: string, at = Date.now()): void {
  repaintingUntil.set(sessionId, at + REPAINT_WINDOW_MS);
}

export function isPtyRepainting(sessionId: string, at = Date.now()): boolean {
  const until = repaintingUntil.get(sessionId);
  if (until === undefined) return false;
  if (until > at) return true;
  repaintingUntil.delete(sessionId);
  return false;
}

export function forgetPtyRepaint(sessionId: string): void {
  repaintingUntil.delete(sessionId);
}
