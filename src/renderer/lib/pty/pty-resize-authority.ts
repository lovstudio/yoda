import { err, ok, type Result } from '@shared/result';
import { rpc } from '@renderer/lib/ipc';
import { isStandaloneKanbanWindowLaunch } from '@renderer/lib/standalone-kanban-window-launch-target';

/**
 * Whether this renderer window may resize backend PTY grids.
 *
 * A PTY has exactly one grid, shared by every window watching the session, and
 * the Agent pre-wraps its output for that grid. So "two windows, two widths" is
 * not a layout choice — whoever resizes last rewraps the TUI for everyone.
 *
 * The standalone board is therefore an observer: its cards are fixed-width
 * tiles of many sessions at once, and letting them impose that geometry would
 * shrink the same session inside the main window. Board terminals still resize
 * their own xterm grid locally (scroll and rendering stay per-window); only the
 * backend SIGWINCH is withheld, so the main window stays authoritative.
 *
 * Spawning is a separate question: a size handed to resume/restart seeds a PTY
 * that does not exist yet, so it cannot disturb another window's live grid.
 * Only mutation of a live grid is gated here.
 */
export const canResizeBackendPty = !isStandaloneKanbanWindowLaunch;

/**
 * Resize a live PTY, unless this window is an observer. The single choke point
 * for `rpc.pty.resize` in the renderer — call this instead, so no surface has to
 * remember the ownership rule.
 */
export function resizeBackendPty(sessionId: string, cols: number, rows: number): void {
  if (!canResizeBackendPty) return;
  void rpc.pty.resize(sessionId, cols, rows);
}

/**
 * Generation-bound resize, or — in an observer window — a plain confirmation
 * that the staged generation is still the live one.
 *
 * Callers use the result as a staging gate ("is this still my generation?"), so
 * an observer must answer that question without imposing its own grid; failing
 * the call instead would leave board cards permanently unable to open.
 */
export async function resizeBackendPtyForRenderer(
  sessionId: string,
  expectedGeneration: number,
  cols: number,
  rows: number
): Promise<
  Result<
    { generation: number; changed: boolean },
    { type: 'not_found' | 'generation_mismatch' | 'resize_failed' }
  >
> {
  if (canResizeBackendPty) {
    return rpc.pty.resizeForRenderer(sessionId, expectedGeneration, cols, rows);
  }
  // Mirror resizeForRenderer's own preconditions: a pending registration means
  // the live generation is already stale, so staging must retry rather than
  // bind to it.
  const state = await rpc.pty.getSessionState(sessionId).catch(() => null);
  if (!state?.live) return err({ type: 'not_found' as const });
  if (state.registering || state.generation !== expectedGeneration) {
    return err({ type: 'generation_mismatch' as const });
  }
  return ok({ generation: expectedGeneration, changed: false });
}
