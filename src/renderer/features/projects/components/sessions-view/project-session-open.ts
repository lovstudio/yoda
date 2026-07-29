import type { Conversation } from '@shared/conversations';
import { openTaskTarget, prepareTaskTarget } from '@renderer/app/open-task-target';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

export function getProjectSessionTaskArchivedAt(
  conversation: Pick<Conversation, 'projectId' | 'taskId'>
): string | null | undefined {
  const task = getTaskManagerStore(conversation.projectId)?.tasks.get(conversation.taskId);
  return task?.data && 'archivedAt' in task.data ? task.data.archivedAt : undefined;
}

export async function openProjectSessionConversation(
  conversation: Pick<Conversation, 'projectId' | 'taskId' | 'id'>,
  navigate: NavigateFnTyped,
  prompt?: { id?: string; index?: number }
): Promise<void> {
  if (getProjectSessionTaskArchivedAt(conversation)) {
    await getTaskManagerStore(conversation.projectId)?.restoreTask(conversation.taskId);
  }
  openTaskTarget(
    {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      ...(prompt?.id ? { promptId: prompt.id } : {}),
      ...(prompt?.index !== undefined ? { promptIndex: prompt.index } : {}),
    },
    navigate
  );
}

/** Restores and provisions a session's task before a cross-surface prompt fork. */
export async function prepareProjectSessionConversation(
  conversation: Pick<Conversation, 'projectId' | 'taskId'>
): Promise<ProvisionedTask | undefined> {
  if (getProjectSessionTaskArchivedAt(conversation)) {
    await getTaskManagerStore(conversation.projectId)?.restoreTask(conversation.taskId);
  }
  await prepareTaskTarget(conversation.projectId, conversation.taskId);
  return asProvisioned(getTaskStore(conversation.projectId, conversation.taskId));
}
