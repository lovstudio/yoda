import { and, desc, eq, isNull } from 'drizzle-orm';
import type { TaskPreview, TaskPreviewSession } from '@shared/kanban';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { getSessionSummary } from '@main/core/conversations/getSessionSummary';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { resolveTaskCwd } from '@main/core/stats/task-cwd';
import { getTaskDiffTotals } from '@main/core/stats/task-diff-snapshot';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';

/**
 * Lightweight task snapshot for the kanban hover preview. Read-only by
 * design: the summary is resolved with `peek` so hovering never spawns a
 * summarization CLI — it surfaces whatever already exists.
 */
export async function getTaskPreview(
  projectId: string,
  taskId: string
): Promise<TaskPreview | null> {
  const [row] = await db
    .select({ task: tasks, projectPath: projects.path })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return null;

  const conversationRows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId),
        isNull(conversations.archivedAt)
      )
    )
    .orderBy(desc(conversations.createdAt));

  const sessions: TaskPreviewSession[] = conversationRows.map((convRow) => {
    const conversation = mapConversationRowToConversation(convRow, true);
    return {
      id: conversation.id,
      title: conversation.title ?? null,
      runtimeId: conversation.runtimeId,
      status: agentSessionRuntimeStore.getStatus({
        projectId,
        taskId,
        conversationId: conversation.id,
      }),
    };
  });

  const [{ totals, source }, summary] = await Promise.all([
    getTaskDiffTotals(row.task),
    peekLatestSummary(projectId, taskId, row.task, row.projectPath, conversationRows[0]),
  ]);

  return {
    summary,
    diff: { ...totals, source },
    sessions,
    lastInteractedAt: row.task.lastInteractedAt ?? null,
  };
}

async function peekLatestSummary(
  projectId: string,
  taskId: string,
  task: typeof tasks.$inferSelect,
  projectPath: string,
  latestRow: typeof conversations.$inferSelect | undefined
): Promise<string | null> {
  if (!latestRow) return null;
  try {
    const conversation = mapConversationRowToConversation(latestRow, true);
    const cwd = await resolveTaskCwd(task, projectPath);
    const result = await getSessionSummary(
      conversation.runtimeId,
      'global',
      projectId,
      taskId,
      cwd,
      conversation.id,
      conversation.title,
      conversation.createdAt ?? null,
      false,
      /* peek */ true
    );
    return result.summary?.text ?? null;
  } catch (error) {
    log.warn('getTaskPreview: summary peek failed', { taskId, error: String(error) });
    return null;
  }
}
