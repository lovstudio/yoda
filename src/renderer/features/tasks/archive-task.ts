import { useCallback } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';

type ArchiveTaskOptions = {
  note?: string;
  skipPreCommand?: boolean;
  /** One-off pre-archive command override (user-edited in the archive dialog). */
  preArchiveCommand?: string;
  /** Bulk callers set this to avoid spawning one undo toast per task. */
  suppressUndoToast?: boolean;
};

type ArchiveConversationOptions = {
  skipPreCommand?: boolean;
};

export function useArchiveTask(projectId: string): {
  archiveTask: (taskId: string, options?: ArchiveTaskOptions) => Promise<void>;
  hasPreArchiveCommand: boolean;
} {
  const { value: homeDraft } = useAppSettingsKey('homeDraft');
  const hasPreArchiveCommand = (homeDraft?.preArchiveCommand ?? '').trim().length > 0;

  const archiveTask = useCallback(
    (taskId: string, options: ArchiveTaskOptions = {}) =>
      archiveTaskOnServer(projectId, taskId, options),
    [projectId]
  );

  return { archiveTask, hasPreArchiveCommand };
}

/**
 * Archive the conversation. The main process owns the whole flow — including
 * running the configured pre-archive command against the live session and
 * waiting for it — so it survives renderer reloads. The conversation store is
 * flagged `isArchiving` for the duration so its tab renders a loading state.
 */
export async function archiveConversationWithPreCommand(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: ArchiveConversationOptions = {}
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;

  const target = provisioned.conversations.conversations.get(conversationId);
  target?.setArchiving(true);
  try {
    await provisioned.conversations.archiveConversation(conversationId, {
      runPreArchiveCommand: !options.skipPreCommand,
    });
  } finally {
    target?.setArchiving(false);
  }
}

/**
 * Full archive flow for a conversation: pre-archive command, then the task
 * itself when this was its last conversation. Re-entrant safe — a no-op while
 * the conversation is already archiving.
 */
export async function archiveConversationFlow(
  projectId: string,
  taskId: string,
  conversationId: string,
  options: ArchiveConversationOptions = {}
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;
  if (provisioned.conversations.conversations.get(conversationId)?.isArchiving) return;

  await archiveConversationWithPreCommand(projectId, taskId, conversationId, options);
  await archiveTaskIfNoConversationsLeft(projectId, taskId);
}

/**
 * Archive the task when its last conversation is gone — archiving the final
 * conversation implies the task itself is finished. No-op while any
 * conversation is still active.
 */
export async function archiveTaskIfNoConversationsLeft(
  projectId: string,
  taskId: string
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned || provisioned.conversations.conversations.size > 0) return;

  await archiveTaskOnServer(projectId, taskId, { skipPreCommand: true });
}

/**
 * Archive the task via the main-process orchestration (pre-archive command →
 * conversation archives → task archive). The task row keeps an
 * `archivingTaskIds` loading state in the sidebar for the whole flow.
 */
export async function archiveTaskOnServer(
  projectId: string,
  taskId: string,
  options: ArchiveTaskOptions = {}
): Promise<void> {
  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) return;

  taskManager.setTaskArchiving(taskId, true);
  try {
    await taskManager.archiveTask(taskId, options);
  } finally {
    taskManager.setTaskArchiving(taskId, false);
  }
}
