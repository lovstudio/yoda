import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { ConversationSession } from '@renderer/features/tasks/conversations/conversation-session';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
  type TaskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';

/**
 * Provisions the room's backing task on demand (mirrors split-view's
 * SelfContainedTaskPane) so its member sessions can render. Only kicks in once
 * a session tab is open — an agent-detail tab needs no live workspace.
 */
export function useProvisionRoomTask(
  projectId: string,
  taskId: string,
  enabled: boolean
): TaskViewKind {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  useEffect(() => {
    if (!enabled || kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;
    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [enabled, kind, projectId, taskId, taskStore]);

  return kind;
}

/**
 * Live terminal of a single room member's session. Reuses the standard session
 * tab UI so a room session looks/behaves identically (terminal + input + search
 * + exited-state handling). Must render inside the room task's
 * ProvisionedTaskProvider + TaskViewWrapper.
 */
export const SessionPty = observer(function SessionPty({
  conversationId,
  isVisible,
}: {
  conversationId: string;
  isVisible: boolean;
}) {
  const provisioned = useProvisionedTask();

  useEffect(() => {
    void provisioned.conversations.ensureConversation(conversationId);
  }, [provisioned, conversationId]);

  const store = provisioned.conversations.conversations.get(conversationId);
  const session = store?.session;

  if (!store || !session || session.status !== 'ready' || !session.pty) return <Connecting />;
  return (
    <PaneSizingProvider paneId={`room-session-${conversationId}`} sessionIds={[session.sessionId]}>
      <ConversationSession conversation={store} isVisible={isVisible} autoFocus={false} />
    </PaneSizingProvider>
  );
});

export function Connecting() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
      <Loader2 className="size-4 animate-spin" /> connecting to session…
    </div>
  );
}
