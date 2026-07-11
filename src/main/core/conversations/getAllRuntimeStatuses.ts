import { and, eq, isNull } from 'drizzle-orm';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { getConversationRunStatus } from './getConversationRuntimeStatuses';

export type RuntimeStatusEntry = {
  projectId: string;
  taskId: string;
  conversationId: string;
  status: AgentSessionRuntimeStatus;
};

/**
 * Cold-load every active conversation's run-state for the renderer's global
 * {@link AgentRuntimeStore}.
 *
 * The in-memory `agentSessionRuntimeStore` only knows sessions touched this
 * process lifetime (it's wiped by restart / HMR and only populated when a
 * conversation object is constructed — i.e. when a task is opened). A freshly
 * started renderer with hundreds of unopened tasks would therefore see all-zero
 * running/unread counts. So we enumerate every non-archived conversation from
 * the DB and derive each status through the same authoritative, transcript-based
 * path as {@link getConversationRuntimeStatuses} (which also self-heals the
 * in-memory cache).
 */
export async function getAllRuntimeStatuses(): Promise<RuntimeStatusEntry[]> {
  const rows = await db
    .select({
      projectId: conversations.projectId,
      taskId: conversations.taskId,
      conversationId: conversations.id,
      runtime: conversations.runtime,
      title: conversations.title,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(
      and(isNull(conversations.archivedAt), isNull(tasks.archivedAt), isNull(projects.archivedAt))
    );

  // Resolve each task's cwd once; many conversations share a task.
  const cwdByTask = new Map<string, string | undefined>();

  const entries: RuntimeStatusEntry[] = [];
  for (const { projectId, taskId, conversationId, runtime, title, createdAt } of rows) {
    const taskKey = `${projectId}\0${taskId}`;
    if (!cwdByTask.has(taskKey)) {
      cwdByTask.set(taskKey, resolveTask(projectId, taskId)?.conversations.taskPath);
    }
    const status = await getConversationRunStatus({
      projectId,
      taskId,
      conversationId,
      provider: runtime ?? '',
      cwd: cwdByTask.get(taskKey) ?? '',
      title,
      createdAt,
    });
    entries.push({ projectId, taskId, conversationId, status });
  }

  return entries;
}
