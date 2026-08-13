import { and, asc, eq } from 'drizzle-orm';
import type { TaskStats } from '@shared/stats';
import { parseConversationSessionSource } from '@main/core/conversations/conversation-session-source';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { resolveConversationUsage } from './session-usage-snapshot';
import { resolveTaskCwd } from './task-cwd';
import { getTaskDiffTotals } from './task-diff-snapshot';

/**
 * Per-task stats: total code delta (live diff with snapshot fallback) and
 * per-session token usage parsed from provider transcripts. Archived
 * conversations are included — their burn belongs to the task.
 */
export async function getTaskStats(projectId: string, taskId: string): Promise<TaskStats | null> {
  const [row] = await db
    .select({ task: tasks, projectPath: projects.path })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return null;

  const [{ totals, source }, conversationRows, cwd] = await Promise.all([
    getTaskDiffTotals(row.task),
    db
      .select()
      .from(conversations)
      .where(eq(conversations.taskId, taskId))
      .orderBy(asc(conversations.createdAt)),
    resolveTaskCwd(row.task, row.projectPath),
  ]);

  const summaries = await Promise.all(
    conversationRows.map(async (conversation) => {
      const sessionSource = parseConversationSessionSource(conversation.config);
      const exactSource =
        sessionSource?.runtimeId === conversation.runtime ? sessionSource : undefined;
      const resolved = await resolveConversationUsage(conversation.runtime, {
        cwd,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        conversationCreatedAt: conversation.createdAt,
        providerSessionId: exactSource?.sessionId,
        providerStateRoot: exactSource?.stateRoot,
      });
      const usage = resolved?.usage;
      return {
        conversationId: conversation.id,
        title: conversation.title,
        runtimeId: conversation.runtime,
        authProvider: conversation.authProvider ?? null,
        tokens: usage?.total ?? null,
        context: usage?.context ?? null,
      };
    })
  );

  return {
    diff: { additions: totals.additions, deletions: totals.deletions, source },
    conversations: summaries,
  };
}
