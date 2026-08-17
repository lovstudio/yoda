import {
  asProvisioned,
  getConversationRuntimeStatus,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { log } from '@renderer/utils/logger';

/** Identifies the one agent session a run-state surface is showing. */
export interface AgentSessionRef {
  projectId: string;
  taskId: string;
  conversationId: string;
}

/**
 * Interrupt one agent session. The heavy lifting lives in the main-process
 * `conversations.interruptConversation` RPC: it sends Esc to the PTY and
 * force-clears the status if no authoritative source confirms the interrupt
 * (covers stale-working sessions whose turn died with an app restart). No
 * optimistic status writes here — a renderer-originated `idle` echoes into the
 * main reducer without being re-broadcast, which would pin the renderer-side
 * runtime mirror at `working`.
 *
 * Single entry point for every surface that shows one session's run state, so
 * the same indicator always interrupts the same way.
 */
export async function interruptConversationSession(session: AgentSessionRef): Promise<void> {
  const { projectId, taskId, conversationId } = session;
  try {
    await rpc.conversations.interruptConversation(projectId, taskId, conversationId);
  } catch (error) {
    log.warn('interruptConversationSession: failed to interrupt conversation', {
      ...session,
      error,
    });
  }
}

/** Interrupt every `working` agent session of a task. */
export function interruptTaskSessions(projectId: string, taskId: string): void {
  const conversationIds = new Set(appState.agentRuntime.workingConversationIds(projectId, taskId));
  const manager = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  if (manager) {
    for (const conversation of manager.conversations.values()) {
      if (getConversationRuntimeStatus(conversation) === 'working') {
        conversationIds.add(conversation.data.id);
      }
    }
  }
  for (const conversationId of conversationIds) {
    void interruptConversationSession({ projectId, taskId, conversationId });
  }
}
