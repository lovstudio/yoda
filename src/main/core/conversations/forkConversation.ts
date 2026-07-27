import { and, eq } from 'drizzle-orm';
import type {
  Conversation,
  ForkConversationParams,
  SessionContextRestoreTarget,
} from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { runtimeOverrideSettings } from '../settings/runtime-settings-service';
import {
  getConversationAgentSessionId,
  getConversationRuntimeStateRoot,
} from './conversation-session-source';
import { forkConversationAtPrompt } from './forkConversationAtPrompt';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getCodexSessionContext } from './getCodexSessionContext';
import { mapConversationRowToConversation } from './utils';

/** Forks a conversation at its latest completed provider-native turn. */
export async function forkConversation(params: ForkConversationParams): Promise<Conversation> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, params.conversationId),
        eq(conversations.projectId, params.projectId),
        eq(conversations.taskId, params.taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error(`Conversation not found: ${params.conversationId}`);

  const source = mapConversationRowToConversation(row);
  const task = resolveTask(params.projectId, params.taskId);
  if (!task) throw new Error(`Task not provisioned: ${params.taskId}`);

  const prompts = await loadForkablePrompts(source, task.conversations.taskPath);
  let promptIndex = prompts.length - 1;
  while (promptIndex >= 0 && !prompts[promptIndex]?.target) promptIndex -= 1;
  const checkpoint = promptIndex >= 0 ? prompts[promptIndex] : undefined;
  if (!checkpoint?.target) {
    throw new Error('Conversation has no completed turn to fork.');
  }

  return forkConversationAtPrompt({
    ...params,
    promptIndex,
    target: checkpoint.target,
  });
}

async function loadForkablePrompts(
  source: Conversation,
  cwd: string
): Promise<Array<{ target?: SessionContextRestoreTarget }>> {
  if (source.runtimeId === 'claude') {
    const providerConfig = await runtimeOverrideSettings.getItem('claude');
    const claudeConfigDir = getConversationRuntimeStateRoot(source, providerConfig);
    const context = await getClaudeSessionContext(cwd, getConversationAgentSessionId(source), {
      claudeConfigDir,
    });
    if (!context) throw new Error('Claude session context not found.');
    return context.prompts.map((prompt) => ({ target: prompt.restoreTarget }));
  }

  if (source.runtimeId === 'codex') {
    const providerConfig = await runtimeOverrideSettings.getItem('codex');
    const codexHome = getConversationRuntimeStateRoot(source, providerConfig);
    const context = await getCodexSessionContext(
      cwd,
      getConversationAgentSessionId(source),
      source.title,
      source.createdAt,
      { codexHome }
    );
    if (!context) throw new Error('Codex session context not found.');
    return context.prompts.map((prompt) => ({ target: prompt.restoreTarget }));
  }

  throw new Error(`Runtime does not support conversation fork: ${source.runtimeId}`);
}
