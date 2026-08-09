import { and, desc, eq, sql } from 'drizzle-orm';
import type { ProjectSessionSource } from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { mapConversationRowToConversation } from './utils';

/**
 * Project-scoped session catalog with only the task metadata needed to render
 * and reopen archived sessions. This avoids hydrating archived Task stores.
 */
export async function getProjectSessionSources(projectId: string): Promise<ProjectSessionSource[]> {
  const rows = await db
    .select({
      conversation: conversations,
      taskName: tasks.name,
      taskArchivedAt: tasks.archivedAt,
    })
    .from(conversations)
    .innerJoin(
      tasks,
      and(eq(conversations.taskId, tasks.id), eq(conversations.projectId, tasks.projectId))
    )
    .where(eq(conversations.projectId, projectId))
    .orderBy(
      desc(
        sql`COALESCE(${conversations.archivedAt}, ${conversations.lastInteractedAt}, ${conversations.updatedAt}, ${conversations.createdAt})`
      )
    );

  return rows.map((row) => ({
    conversation: mapConversationRowToConversation(row.conversation, false),
    taskName: row.taskName,
    taskArchivedAt: row.taskArchivedAt,
  }));
}
