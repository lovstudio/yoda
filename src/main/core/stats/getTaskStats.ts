import { and, asc, eq } from 'drizzle-orm';
import type { TaskStats } from '@shared/stats';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { resolveTaskCwd } from './task-cwd';
import { getTaskDiffTotals } from './task-diff-snapshot';
import { sessionUsageCache } from './usage-cache';

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
      const usage = await sessionUsageCache.getUsage(conversation.runtime, {
        cwd,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        conversationCreatedAt: conversation.createdAt,
      });
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
