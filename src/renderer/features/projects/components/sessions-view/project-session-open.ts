import type { Conversation } from '@shared/conversations';
import { openTaskTarget } from '@renderer/app/open-task-target';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

export function getProjectSessionTaskArchivedAt(
  conversation: Pick<Conversation, 'projectId' | 'taskId'>
): string | null | undefined {
  const task = getTaskManagerStore(conversation.projectId)?.tasks.get(conversation.taskId);
  return task?.data && 'archivedAt' in task.data ? task.data.archivedAt : undefined;
}

export async function openProjectSessionConversation(
  conversation: Pick<Conversation, 'projectId' | 'taskId' | 'id'>,
  navigate: NavigateFnTyped
): Promise<void> {
  if (getProjectSessionTaskArchivedAt(conversation)) {
    await getTaskManagerStore(conversation.projectId)?.restoreTask(conversation.taskId);
  }
  openTaskTarget(
    {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
    },
    navigate
  );
}
