import { and, eq, isNull } from 'drizzle-orm';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { formatProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskManager } from '@main/core/tasks/task-manager';
import { getTerminalsForTask } from '@main/core/terminals/getTerminalsForTask';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { mapTaskRowToTask } from './utils/utils';

export async function provisionTask(taskId: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task not found: ${taskId}`);
  if (row.archivedAt || row.archiveRequestedAt) {
    throw new Error(`Cannot provision archived task: ${taskId}`);
  }
  if (row.setupStatus !== 'ready') {
    throw new Error(row.setupError || `Task setup is not ready: ${row.setupStatus}`);
  }

  const task = mapTaskRowToTask(row);
  const project = projectManager.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const existingTask = taskManager.getTask(taskId);

  if (existingTask) {
    const existingConversations = await loadTaskConversationRows(taskId);
    const wsId = taskManager.getWorkspaceId(taskId) ?? '';
    return {
      path: workspaceRegistry.get(wsId)?.path ?? '',
      workspaceId: wsId,
      sshConnectionId: undefined,
      conversations: existingConversations.map((conversation) =>
        mapConversationRowToConversation(conversation, false)
      ),
    };
  }

  const [existingTerminals, conversationRows] = await Promise.all([
    getTerminalsForTask(task.projectId, taskId),
    loadTaskConversationRows(taskId),
  ]);
  const existingConversations = conversationRows.map((conversation) =>
    mapConversationRowToConversation(conversation, true)
  );

  const result = await taskManager.provisionTask(
    project,
    task,
    existingConversations,
    existingTerminals
  );
  if (!result.success) {
    throw new Error(`Failed to provision task: ${formatProvisionTaskError(result.error)}`);
  }

  const { persistData } = result.data;

  await db
    .update(tasks)
    .set({
      workspaceId: persistData.workspaceId,
      workspaceProviderData: persistData.workspaceProviderData
        ? JSON.stringify(persistData.workspaceProviderData)
        : null,
    })
    .where(eq(tasks.id, taskId));
  telemetryService.capture('task_provisioned', {
    project_id: task.projectId,
    task_id: task.id,
  });

  return {
    path: workspaceRegistry.get(persistData.workspaceId)?.path ?? '',
    workspaceId: persistData.workspaceId,
    sshConnectionId: persistData.sshConnectionId,
    conversations: conversationRows.map((conversation) =>
      mapConversationRowToConversation(conversation, false)
    ),
  };
}

function loadTaskConversationRows(taskId: string) {
  return db
    .select()
    .from(conversations)
    .where(and(eq(conversations.taskId, taskId), isNull(conversations.archivedAt)));
}
