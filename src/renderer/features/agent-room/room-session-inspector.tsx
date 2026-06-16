import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { ConversationSession } from '@renderer/features/tasks/conversations/conversation-session';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
  useProvisionedTask,
} from '@renderer/features/tasks/task-view-context';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';

/**
 * Live terminal of a single room member's session, embedded in the chat so the
 * lead can "check the session" without leaving the room. Provisions the room's
 * backing task on demand (mirrors split-view's SelfContainedTaskPane) then
 * renders just that conversation's PTY.
 */
export const RoomSessionInspector = observer(function RoomSessionInspector({
  projectId,
  taskId,
  conversationId,
  title,
  onClose,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
  title: string;
  onClose: () => void;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;
    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-l border-border bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-background-2 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {kind === 'ready' ? (
          <TaskViewWrapper projectId={projectId} taskId={taskId} hosted>
            <ProvisionedTaskProvider projectId={projectId} taskId={taskId}>
              <SessionPty conversationId={conversationId} />
            </ProvisionedTaskProvider>
          </TaskViewWrapper>
        ) : (
          <Connecting />
        )}
      </div>
    </aside>
  );
});

const SessionPty = observer(function SessionPty({ conversationId }: { conversationId: string }) {
  const provisioned = useProvisionedTask();

  useEffect(() => {
    void provisioned.conversations.ensureConversation(conversationId);
  }, [provisioned, conversationId]);

  const store = provisioned.conversations.conversations.get(conversationId);
  const session = store?.session;

  if (!store || !session || session.status !== 'ready' || !session.pty) return <Connecting />;
  // Reuse the standard session tab UI so a room session looks/behaves identically
  // (terminal + input + search + exited-state handling).
  return (
    <PaneSizingProvider paneId={`room-session-${conversationId}`} sessionIds={[session.sessionId]}>
      <ConversationSession conversation={store} isVisible autoFocus={false} />
    </PaneSizingProvider>
  );
});

function Connecting() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
      <Loader2 className="size-4 animate-spin" /> connecting to session…
    </div>
  );
}
