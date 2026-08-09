import type { Conversation } from '@shared/conversations';
import { openTaskTarget, prepareTaskTarget } from '@renderer/app/open-task-target';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  asProvisioned,
  getTaskManagerStore,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

export type ProjectSessionTaskTarget = Pick<Conversation, 'projectId' | 'taskId' | 'id'> & {
  taskArchivedAt: string | null;
};

async function prepareOwningTask(target: ProjectSessionTaskTarget): Promise<void> {
  // Mount without selecting/provisioning the archived task, then point-load and
  // restore it before any navigation can race the normal task-open flow.
  await prepareTaskTarget(target.projectId);
  const taskManager = getTaskManagerStore(target.projectId);
  if (!taskManager) throw new Error(`Project ${target.projectId} could not be mounted`);
  const loaded = await taskManager.ensureTaskLoaded(target.taskId);
  if (!loaded) throw new Error(`Task ${target.taskId} could not be loaded`);
  const task = taskManager.tasks.get(target.taskId);
  if (!task || task.state === 'unregistered') {
    throw new Error(`Task ${target.taskId} could not be loaded`);
  }
  if ('archivedAt' in task.data && task.data.archivedAt) {
    await taskManager.restoreTask(target.taskId);
  }
}

export async function openProjectSessionConversation(
  target: ProjectSessionTaskTarget,
  navigate: NavigateFnTyped,
  prompt?: { id?: string; index?: number }
): Promise<void> {
  await prepareOwningTask(target);
  openTaskTarget(
    {
      projectId: target.projectId,
      taskId: target.taskId,
      conversationId: target.id,
      ...(prompt?.id ? { promptId: prompt.id } : {}),
      ...(prompt?.index !== undefined ? { promptIndex: prompt.index } : {}),
    },
    navigate
  );
}

/** Restores and provisions a session's task before a cross-surface prompt fork. */
export async function prepareProjectSessionConversation(
  target: ProjectSessionTaskTarget
): Promise<ProvisionedTask | undefined> {
  await prepareOwningTask(target);
  await prepareTaskTarget(target.projectId, target.taskId);
  return asProvisioned(getTaskStore(target.projectId, target.taskId));
}
