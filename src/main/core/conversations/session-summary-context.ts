import { and, desc, eq } from 'drizzle-orm';
import type {
  Conversation,
  SessionDeliverySummary,
  SessionSummaryResult,
  SessionSummaryScope,
} from '@shared/conversations';
import { taskManager } from '@main/core/tasks/task-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { getSessionSummary } from './getSessionSummary';
import { getManualSummary, getStoredSummary } from './session-summary-store';
import { mapConversationRowToConversation } from './utils';

type ConversationSummaryTarget = {
  conversation: Conversation;
  cwd: string;
  taskName: string | null;
};

type ConversationSummaryKey = {
  projectId: string;
  taskId: string;
  conversationId: string;
};

const DELIVERY_SUMMARY_LIMIT = 20;
const DEFAULT_TASK_SUMMARY_LIMIT = 8;

export async function refreshConversationSummary(
  key: ConversationSummaryKey,
  scope: SessionSummaryScope = 'global'
): Promise<SessionSummaryResult | null> {
  const target = await loadConversationSummaryTarget(key);
  if (!target) return null;
  return getSessionSummary(
    target.conversation.runtimeId,
    scope,
    key.projectId,
    key.taskId,
    target.cwd,
    key.conversationId,
    target.conversation.title,
    target.conversation.createdAt ?? null,
    false,
    false
  );
}

export async function getConversationDeliverySummary(
  key: ConversationSummaryKey,
  options: { refresh?: boolean } = {}
): Promise<SessionDeliverySummary | null> {
  const target = await loadConversationSummaryTarget(key);
  if (!target) return null;

  const global = await getSessionSummary(
    target.conversation.runtimeId,
    'global',
    key.projectId,
    key.taskId,
    target.cwd,
    key.conversationId,
    target.conversation.title,
    target.conversation.createdAt ?? null,
    false,
    !options.refresh
  );
  if (global.summary) return toDeliverySummary(key, target, global.summary);

  if (options.refresh) {
    const staleGlobal = await getSessionSummary(
      target.conversation.runtimeId,
      'global',
      key.projectId,
      key.taskId,
      target.cwd,
      key.conversationId,
      target.conversation.title,
      target.conversation.createdAt ?? null,
      false,
      true
    );
    if (staleGlobal.summary) return toDeliverySummary(key, target, staleGlobal.summary);
  }

  const recent = await getSessionSummary(
    target.conversation.runtimeId,
    'recent',
    key.projectId,
    key.taskId,
    target.cwd,
    key.conversationId,
    target.conversation.title,
    target.conversation.createdAt ?? null,
    false,
    true
  );
  return recent.summary ? toDeliverySummary(key, target, recent.summary) : null;
}

export async function getTaskDeliverySummaries(
  projectId: string,
  taskId: string
): Promise<SessionDeliverySummary[]> {
  const rows = await db
    .select({
      conversation: conversations,
      taskName: tasks.name,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId)))
    .orderBy(desc(conversations.lastInteractedAt), desc(conversations.updatedAt))
    .limit(DEFAULT_TASK_SUMMARY_LIMIT);

  const summaries = await Promise.all(rows.map((row) => readPersistedDeliverySummary(row)));
  return summaries.filter((summary): summary is SessionDeliverySummary => summary !== null);
}

export async function getProjectDeliverySummaries(
  projectId: string,
  limit = 8
): Promise<SessionDeliverySummary[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), DELIVERY_SUMMARY_LIMIT);
  const rows = await db
    .select({
      conversation: conversations,
      taskName: tasks.name,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(eq(conversations.projectId, projectId))
    .orderBy(desc(conversations.lastInteractedAt), desc(conversations.updatedAt))
    .limit(boundedLimit * 3);

  const summaries = await Promise.all(rows.map((row) => readPersistedDeliverySummary(row)));
  return summaries
    .filter((summary): summary is SessionDeliverySummary => summary !== null)
    .slice(0, boundedLimit);
}

async function readPersistedDeliverySummary(row: {
  conversation: typeof conversations.$inferSelect;
  taskName: string | null;
}): Promise<SessionDeliverySummary | null> {
  const summary =
    (await getManualSummary(row.conversation.id, 'global')) ??
    (await getStoredSummary(row.conversation.id, 'global'))?.summary ??
    (await getStoredSummary(row.conversation.id, 'recent'))?.summary ??
    null;
  if (!summary?.text.trim()) return null;

  return {
    conversationId: row.conversation.id,
    taskId: row.conversation.taskId,
    taskName: row.taskName,
    conversationTitle: row.conversation.title,
    text: summary.text.trim(),
    timestamp: summary.timestamp,
  };
}

async function loadConversationSummaryTarget(
  key: ConversationSummaryKey
): Promise<ConversationSummaryTarget | null> {
  const [row] = await db
    .select({
      conversation: conversations,
      taskName: tasks.name,
      taskWorkspaceId: tasks.workspaceId,
      projectPath: projects.path,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(conversations.id, key.conversationId))
    .limit(1);
  if (!row) return null;
  if (row.conversation.projectId !== key.projectId || row.conversation.taskId !== key.taskId) {
    return null;
  }

  const workspaceId = taskManager.getWorkspaceId(key.taskId) ?? row.taskWorkspaceId ?? undefined;
  const cwd =
    (workspaceId ? workspaceRegistry.get(workspaceId)?.path : undefined) ?? row.projectPath;
  return {
    conversation: mapConversationRowToConversation(row.conversation, true),
    cwd,
    taskName: row.taskName,
  };
}

function toDeliverySummary(
  key: ConversationSummaryKey,
  target: ConversationSummaryTarget,
  summary: { text: string; timestamp: string | null }
): SessionDeliverySummary {
  return {
    conversationId: key.conversationId,
    taskId: key.taskId,
    taskName: target.taskName,
    conversationTitle: target.conversation.title,
    text: summary.text.trim(),
    timestamp: summary.timestamp,
  };
}
