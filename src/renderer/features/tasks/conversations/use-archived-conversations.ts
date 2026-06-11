import { useEffect, useState } from 'react';
import type { Conversation } from '@shared/conversations';
import {
  conversationArchivedChannel,
  conversationUnarchivedChannel,
} from '@shared/events/conversationEvents';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

export function conversationTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

/**
 * Archived conversations are filtered out of the active conversation manager
 * store (and dropped from it on archive events), so consumers fetch them on
 * demand. Re-fetches whenever an archive/unarchive event lands for this task
 * so the active and archived lists stay in sync.
 */
export function useArchivedConversations(projectId: string, taskId: string): Conversation[] {
  const [archived, setArchived] = useState<Conversation[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void rpc.conversations
        .getArchivedConversationsForTask(projectId, taskId)
        .then((rows) => {
          if (cancelled) return;
          setArchived(
            rows.sort(
              (a, b) =>
                conversationTime(b.archivedAt ?? b.lastInteractedAt) -
                conversationTime(a.archivedAt ?? a.lastInteractedAt)
            )
          );
        })
        .catch((error: unknown) => {
          log.warn('useArchivedConversations: failed to load archived conversations', {
            projectId,
            taskId,
            error,
          });
        });
    };

    refresh();
    const offArchived = events.on(conversationArchivedChannel, (event) => {
      if (event.projectId === projectId && event.taskId === taskId) refresh();
    });
    const offUnarchived = events.on(conversationUnarchivedChannel, (event) => {
      if (event.projectId === projectId && event.taskId === taskId) refresh();
    });
    return () => {
      cancelled = true;
      offArchived();
      offUnarchived();
    };
  }, [projectId, taskId]);

  return archived;
}

/**
 * Unarchive a conversation, re-register it with the task's live conversation
 * manager, and open its tab. Call from event handlers only.
 */
export async function reopenArchivedConversation(conversation: Conversation): Promise<void> {
  await rpc.conversations.unarchiveConversation(
    conversation.projectId,
    conversation.taskId,
    conversation.id
  );
  const provisioned = asProvisioned(getTaskStore(conversation.projectId, conversation.taskId));
  if (!provisioned) return;
  await provisioned.conversations.ensureConversation(conversation.id);
  provisioned.taskView.tabManager.openConversation(conversation.id);
}
