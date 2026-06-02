import { tmuxUnavailableChannel } from '@shared/events/appEvents';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { makeTmuxSessionName } from './tmux-session-name';

const TMUX_CHECK_TIMEOUT_MS = 2_000;
const TMUX_CHECK_MAX_BUFFER = 4_096;

export async function isTmuxAvailable(ctx: IExecutionContext): Promise<boolean> {
  try {
    await ctx.exec('tmux', ['-V'], {
      timeout: TMUX_CHECK_TIMEOUT_MS,
      maxBuffer: TMUX_CHECK_MAX_BUFFER,
    });
    return true;
  } catch (error) {
    log.debug('tmux unavailable for PTY session', { error: String(error) });
    return false;
  }
}

export async function resolveAvailableTmuxSessionName({
  auto,
  ctx,
  requested,
  sessionId,
  source,
  connectionId,
}: {
  auto: boolean;
  connectionId?: string;
  ctx: IExecutionContext;
  requested: boolean;
  sessionId: string;
  source: string;
}): Promise<string | undefined> {
  if (!requested && !auto) return undefined;
  if (await isTmuxAvailable(ctx)) return makeTmuxSessionName(sessionId);
  events.emit(tmuxUnavailableChannel, { source, sessionId, requested, auto, connectionId });
  if (requested) {
    log.warn(`${source}: tmux requested but unavailable; falling back to direct PTY`, {
      sessionId,
      connectionId,
    });
  }
  return undefined;
}
