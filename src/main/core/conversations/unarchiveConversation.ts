import { and, eq, sql } from 'drizzle-orm';
import { conversationUnarchivedChannel } from '@shared/events/conversationEvents';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { db } from '@main/db/client';
import {
  conversations,
  projects,
  tasks,
  type ConversationRow,
  type TaskRow,
} from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveAgentResumeSessionId } from './codex-session-id';
import { ensureCodexThreadUnarchived } from './codex-unarchive';
import { conversationEvents } from './conversation-events';
import { mapConversationRowToConversation } from './utils';

export async function unarchiveConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const [row] = await db
    .select({
      conversation: conversations,
      task: tasks,
      projectPath: projects.path,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    )
    .limit(1);
  if (!row) return;

  await db
    .update(conversations)
    .set({
      archivedAt: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId)
      )
    );

  await unarchiveCodexConversation({
    conversation: row.conversation,
    task: row.task,
    projectPath: row.projectPath,
    project: projectManager.getProject(projectId),
  }).catch((error: unknown) => {
    log.warn('unarchiveConversation: Codex session unarchive failed', {
      conversationId,
      error: String(error),
    });
  });

  conversationEvents._emit('conversation:unarchived', conversationId, projectId, taskId);
  events.emit(conversationUnarchivedChannel, { conversationId, projectId, taskId });
  telemetryService.capture('conversation_unarchived', {
    project_id: projectId,
    task_id: taskId,
    conversation_id: conversationId,
  });
}

async function unarchiveCodexConversation({
  conversation,
  task,
  project,
  projectPath,
}: {
  conversation: ConversationRow;
  task: TaskRow;
  project: ProjectProvider | undefined;
  projectPath: string;
}): Promise<void> {
  if (!project || conversation.runtime !== 'codex') return;

  const cwd = await resolveTaskCwd({ task, project, projectPath });
  const providerConfig = await runtimeOverrideSettings.getItem('codex');
  const mappedConversation = mapConversationRowToConversation(conversation, true);
  const threadId = resolveAgentResumeSessionId(mappedConversation, cwd);
  await ensureCodexThreadUnarchived({
    runtimeId: mappedConversation.runtimeId,
    providerConfig,
    threadId,
    ctx: project.ctx,
  });
}

async function resolveTaskCwd({
  task,
  project,
  projectPath,
}: {
  task: TaskRow;
  project: ProjectProvider;
  projectPath: string;
}): Promise<string> {
  if (!task.taskBranch) return projectPath;

  try {
    return (await project.getWorktreeForBranch(task.taskBranch)) ?? projectPath;
  } catch (error) {
    log.warn('unarchiveConversation: failed to resolve task worktree for Codex unarchive', {
      taskId: task.id,
      error: String(error),
    });
    return projectPath;
  }
}
