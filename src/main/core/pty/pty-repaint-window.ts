/**
 * Short-lived "this session is repainting because we asked it to" windows.
 *
 * A tmux-backed session redraws its whole pane whenever its client attaches or
 * resizes — verified at byte level: the redraw re-emits every visible row,
 * including lines written by earlier turns. Output produced that way is a copy
 * of what is already on screen, so no observer may read it as fresh activity.
 * Without this guard, opening a working task attaches and resizes its terminal,
 * tmux re-emits a previous turn's `Conversation interrupted` line, and the
 * interrupt sniffer clears a live turn's `working` status.
 *
 * Keyed by PTY session id, because the resize choke point knows only that.
 */

/** Resize repaints land in one burst right after SIGWINCH: slack, not a poll. */
export const PTY_RESIZE_REPAINT_WINDOW_MS = 1_500;

/**
 * An attach repaint has to clear shell startup and tmux's server version probe
 * before `attach-session` even runs, so it needs far more slack than SIGWINCH.
 * Over-covering costs little: the only interrupt this window can hide is one the
 * user types into the terminal, and Yoda's own stop button clears the status
 * itself instead of going through an output sniffer.
 */
export const PTY_ATTACH_REPAINT_WINDOW_MS = 6_000;

const repaintingUntil = new Map<string, number>();

export function notePtyRepaint(
  sessionId: string,
  windowMs = PTY_RESIZE_REPAINT_WINDOW_MS,
  at = Date.now()
): void {
  repaintingUntil.set(sessionId, Math.max(repaintingUntil.get(sessionId) ?? 0, at + windowMs));
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
