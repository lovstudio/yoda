import type { IExecutionContext } from '@main/core/execution-context/types';
import { isTmuxSessionAgentAlive } from '@main/core/pty/tmux-session-name';

/**
 * What a PTY exit actually means for the Agent behind it.
 *
 * `transport-lost` sessions must keep their run-state watchers, runtime status
 * and pending input queue: the provider CLI is still mid-turn inside tmux, and
 * the next mount reattaches to it.
 */
export type PtyExitClassification = 'agent-exited' | 'transport-lost';

/**
 * Decide whether a PTY that died on its own took the Agent with it.
 *
 * The PTY Yoda spawns for a tmux-backed session is only an `attach-session`
 * wrapper, so the surviving pane — not the dead wrapper — is the source of
 * truth. Sessions without tmux have no such indirection and always mean the
 * Agent is gone.
 */
export async function classifyLostPtyTransport(
  ctx: IExecutionContext,
  tmuxSessionName: string | undefined
): Promise<PtyExitClassification> {
  if (!tmuxSessionName) return 'agent-exited';
  return (await isTmuxSessionAgentAlive(ctx, tmuxSessionName)) ? 'transport-lost' : 'agent-exited';
}
