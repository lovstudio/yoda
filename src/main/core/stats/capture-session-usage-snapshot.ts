import { eq } from 'drizzle-orm';
import { parseConversationSessionSource } from '@main/core/conversations/conversation-session-source';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { resolveConversationUsage } from './session-usage-snapshot';
import { resolveTaskCwd } from './task-cwd';

/** Capture one conversation on process exit, before provider retention removes its transcript. */
export async function captureConversationUsageSnapshot(conversationId: string): Promise<void> {
  const [row] = await db
    .select({ conversation: conversations, task: tasks, projectPath: projects.path })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row || (row.conversation.runtime !== 'claude' && row.conversation.runtime !== 'codex')) {
    return;
  }

  const cwd = await resolveTaskCwd(row.task, row.projectPath);
  const source = parseConversationSessionSource(row.conversation.config);
  const exactSource = source?.runtimeId === row.conversation.runtime ? source : undefined;
  await resolveConversationUsage(row.conversation.runtime, {
    cwd,
    conversationId: row.conversation.id,
    conversationTitle: row.conversation.title,
    conversationCreatedAt: row.conversation.createdAt,
    providerSessionId: exactSource?.sessionId,
    providerStateRoot: exactSource?.stateRoot,
  });
}
