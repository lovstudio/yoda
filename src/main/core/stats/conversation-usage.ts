import { and, eq } from 'drizzle-orm';
import type { YodaSessionShareUsage } from '@shared/session-share';
import { parseConversationSessionSource } from '@main/core/conversations/conversation-session-source';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { resolveConversationUsage } from './session-usage-snapshot';
import { resolveTaskCwd } from './task-cwd';
import { computeUsageCost } from './usage-cost';

/**
 * Token and cost rollup for one conversation, shaped for a session share.
 *
 * Returns null whenever usage cannot be established — an unsupported runtime,
 * or a transcript that is gone with no durable snapshot behind it. Callers must
 * treat null as "unknown", never as zero: a share that renders 0 tokens for a
 * long session is worse than one that shows no usage at all.
 */
export async function getConversationShareUsage(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<YodaSessionShareUsage | null> {
  const [row] = await db
    .select({ conversation: conversations, task: tasks, projectPath: projects.path })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.taskId, taskId),
        eq(tasks.projectId, projectId)
      )
    )
    .limit(1);
  if (!row) return null;

  const { conversation } = row;
  const sessionSource = parseConversationSessionSource(conversation.config);
  const exactSource = sessionSource?.runtimeId === conversation.runtime ? sessionSource : undefined;
  const cwd = await resolveTaskCwd(row.task, row.projectPath);
  const resolved = await resolveConversationUsage(conversation.runtime, {
    cwd,
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    conversationCreatedAt: conversation.createdAt,
    providerSessionId: exactSource?.sessionId,
    providerStateRoot: exactSource?.stateRoot,
  });
  if (!resolved?.usage) return null;

  const cost = computeUsageCost(resolved.usage.byModel);
  return {
    tokens: resolved.usage.total,
    costUsd: cost?.usd ?? null,
    // A missing rate makes the price a floor, so the page must not present it
    // as exact. Unpriced model ids stay local — they are not the reader's problem.
    costPartial: (cost?.unpricedModels.length ?? 0) > 0,
  };
}
