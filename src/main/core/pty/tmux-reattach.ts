import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty } from './pty';
import { listTmuxSessionMarkersStrict, type TmuxSessionMarker } from './tmux-session-name';

const TMUX_REATTACH_CONFIRM_TIMEOUT_MS = 2_000;
const TMUX_REATTACH_POLL_INTERVAL_MS = 50;

export class TmuxReattachMissError extends Error {
  constructor() {
    super('The persisted tmux session ended before it could be reattached.');
    this.name = 'TmuxReattachMissError';
  }
}

/**
 * Confirm the shell actually attached to the same sampled tmux session before
 * provider startup is acknowledged. A successful SSH/local PTY open alone is
 * not evidence: the strict wrapper can still exit when its pane disappears.
 */
export async function waitForTmuxReattach({
  ctx,
  pty,
  baseline,
}: {
  ctx: IExecutionContext;
  pty: Pty;
  baseline: TmuxSessionMarker;
}): Promise<void> {
  let exited = false;
  let wakeExit!: () => void;
  const exit = new Promise<void>((resolve) => {
    wakeExit = resolve;
  });
  pty.onExit(() => {
    exited = true;
    wakeExit();
  });

  const deadline = Date.now() + TMUX_REATTACH_CONFIRM_TIMEOUT_MS;
  while (!exited && Date.now() <= deadline) {
    const markers = await listTmuxSessionMarkersStrict(ctx);
    if (exited) break;
    const current = markers.find((marker) => marker.sessionName === baseline.sessionName);
    if (!current || !sameTmuxSessionInstance(current, baseline)) break;
    if (current.attachedClients > baseline.attachedClients) return;
    await Promise.race([delay(TMUX_REATTACH_POLL_INTERVAL_MS), exit]);
  }
  throw new TmuxReattachMissError();
}

function sameTmuxSessionInstance(current: TmuxSessionMarker, baseline: TmuxSessionMarker): boolean {
  return (
    (baseline.panePid === undefined || current.panePid === baseline.panePid) &&
    (baseline.createdAtMs === undefined || current.createdAtMs === baseline.createdAtMs)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
