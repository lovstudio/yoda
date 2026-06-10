import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';

/**
 * Interrupt every `working` agent session of a task. The heavy lifting lives in
 * the main-process `conversations.interruptConversation` RPC: it sends Esc to
 * the PTY and force-clears the status if no authoritative source confirms the
 * interrupt (covers stale-working sessions whose turn died with an app
 * restart). No optimistic status writes here — a renderer-originated `idle`
 * echoes into the main reducer without being re-broadcast, which would pin the
 * renderer-side runtime mirror at `working`.
 */
export function interruptTaskSessions(projectId: string, taskId: string): void {
  const conversationIds = new Set(appState.agentRuntime.workingConversationIds(projectId, taskId));
  const manager = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  if (manager) {
    for (const conversation of manager.conversations.values()) {
      if (conversation.status === 'working') conversationIds.add(conversation.data.id);
    }
  }
  for (const conversationId of conversationIds) {
    void rpc.conversations.interruptConversation(projectId, taskId, conversationId).catch(() => {});
  }
}
