import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ClaudeSessionPrompt, ProjectPromptSource } from '@shared/conversations';
import { runtimeOverrideSettings } from '@main/core/settings/runtime-settings-service';
import { resolveTaskCwd } from '@main/core/stats/task-cwd';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import { getClaudeSessionPrompts } from './getClaudeSessionContext';
import { getCodexSessionPrompts } from './getCodexSessionContext';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import { localAgentSessionCatalog } from './local-agent-session-catalog-instance';
import { mapConversationRowToConversation } from './utils';

const PROJECT_PROMPT_RUNTIME_IDS: Array<'claude' | 'codex'> = ['claude', 'codex'];

/**
 * Reads only the relational catalog. The renderer uses this ordered list to
 * schedule transcript scans and can paint every completed file immediately.
 */
export async function getProjectPromptSources(projectId: string): Promise<ProjectPromptSource[]> {
  const rows = await db
    .select({
      conversation: conversations,
      taskName: tasks.name,
      taskArchivedAt: tasks.archivedAt,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .where(
      and(
        eq(conversations.projectId, projectId),
        inArray(conversations.runtime, PROJECT_PROMPT_RUNTIME_IDS)
      )
    )
    .orderBy(
      desc(
        sql`COALESCE(${conversations.lastInteractedAt}, ${conversations.updatedAt}, ${conversations.createdAt})`
      )
    );

  return rows.map((row) => ({
    conversation: mapConversationRowToConversation(row.conversation, false),
    taskName: row.taskName,
    taskArchivedAt: row.taskArchivedAt,
  }));
}

/**
 * Loads one provider transcript at a time. Imported/native sessions use their
 * catalog cwd; regular Yoda tasks resolve the current worktree or project root.
 */
export async function getProjectConversationPrompts(
  projectId: string,
  conversationId: string
): Promise<ClaudeSessionPrompt[]> {
  const [row] = await db
    .select({
      conversation: conversations,
      task: tasks,
      projectPath: projects.path,
    })
    .from(conversations)
    .innerJoin(tasks, eq(conversations.taskId, tasks.id))
    .innerJoin(projects, eq(conversations.projectId, projects.id))
    .where(and(eq(conversations.projectId, projectId), eq(conversations.id, conversationId)))
    .limit(1);
  if (!row) return [];

  const conversation = mapConversationRowToConversation(row.conversation, false);
  if (!PROJECT_PROMPT_RUNTIME_IDS.includes(conversation.runtimeId as 'claude' | 'codex')) {
    return [];
  }

  const source = conversation.sessionSource;
  const catalogSession = source ? await localAgentSessionCatalog.get(source.catalogId) : undefined;
  const cwd = catalogSession?.cwd ?? (await resolveTaskCwd(row.task, row.projectPath));
  const providerConfig = await runtimeOverrideSettings.getItem(conversation.runtimeId);

  if (conversation.runtimeId === 'claude') {
    return getClaudeSessionPrompts(
      cwd,
      source?.runtimeId === 'claude' ? source.sessionId : conversation.id,
      {
        claudeConfigDir:
          source?.runtimeId === 'claude'
            ? source.stateRoot
            : resolveRuntimeStateDirectory('claude', providerConfig),
      }
    );
  }

  if (conversation.runtimeId === 'codex') {
    return getCodexSessionPrompts(
      cwd,
      source?.runtimeId === 'codex' ? source.sessionId : conversation.id,
      conversation.title,
      conversation.createdAt ?? null,
      {
        codexHome:
          source?.runtimeId === 'codex'
            ? source.stateRoot
            : resolveRuntimeStateDirectory('codex', providerConfig),
      }
    );
  }

  return [];
}
