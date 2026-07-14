import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type {
  Conversation,
  ForkConversationAtPromptParams,
  SessionContextRestoreTarget,
} from '@shared/conversations';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { runtimeOverrideSettings } from '../settings/runtime-settings-service';
import { deleteClaudeTranscript, forkClaudeTranscript } from './claude-transcript-fork';
import { deleteCodexThread, forkCodexThread } from './codex-thread-fork';
import { conversationEvents } from './conversation-events';
import { getClaudeSessionContext } from './getClaudeSessionContext';
import { getCodexSessionContext } from './getCodexSessionContext';
import { resolveRuntimeStateDirectory } from './impl/runtime-env';
import { mapConversationRowToConversation } from './utils';

const pendingContextForks = new Map<string, Promise<Conversation>>();

export function forkConversationAtPrompt(
  params: ForkConversationAtPromptParams
): Promise<Conversation> {
  const key = contextForkKey(params);
  const existing = pendingContextForks.get(key);
  if (existing) return existing;

  const pending = createConversationFork(params).finally(() => {
    if (pendingContextForks.get(key) === pending) pendingContextForks.delete(key);
  });
  pendingContextForks.set(key, pending);
  return pending;
}

async function createConversationFork(
  params: ForkConversationAtPromptParams
): Promise<Conversation> {
  if (!Number.isInteger(params.promptIndex) || params.promptIndex < 0) {
    throw new Error('Invalid prompt index.');
  }

  const [source] = await db
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
  if (!source) {
    throw new Error(`Conversation not found: ${params.conversationId}`);
  }
  // Validate the copied config before creating an external provider fork.
  mapConversationRowToConversation(source);

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error(`Task not provisioned: ${params.taskId}`);
  }
  const cwd = task.conversations.taskPath;

  let forkedConversationId: string;
  let deleteProviderFork: () => Promise<void>;
  if (source.runtime === 'claude') {
    if (params.target.kind !== 'claude-message') {
      throw new Error('Prompt restore target does not match the conversation runtime.');
    }
    const claudeConfigDir = resolveRuntimeStateDirectory(
      'claude',
      await runtimeOverrideSettings.getItem('claude')
    );
    const context = await getClaudeSessionContext(cwd, source.id, { claudeConfigDir });
    const prompt = context?.prompts[params.promptIndex];
    assertPromptTarget(prompt?.restoreTarget, params.target);

    forkedConversationId = randomUUID();
    await forkClaudeTranscript({
      cwd,
      claudeConfigDir,
      sourceSessionId: source.id,
      targetSessionId: forkedConversationId,
      targetMessageId: params.target.messageId,
    });
    deleteProviderFork = () =>
      deleteClaudeTranscript({ cwd, claudeConfigDir, sessionId: forkedConversationId });
  } else if (source.runtime === 'codex') {
    if (params.target.kind !== 'codex-turn') {
      throw new Error('Prompt restore target does not match the conversation runtime.');
    }
    const codexHome = resolveRuntimeStateDirectory(
      'codex',
      await runtimeOverrideSettings.getItem('codex')
    );
    const context = await getCodexSessionContext(cwd, source.id, source.title, source.createdAt, {
      codexHome,
    });
    const prompt = context?.prompts[params.promptIndex];
    assertPromptTarget(prompt?.restoreTarget, params.target);
    if (!context) {
      throw new Error('Codex session context not found.');
    }

    forkedConversationId = await forkCodexThread({
      threadId: context.threadId,
      lastTurnId: params.target.turnId,
      cwd,
    });
    deleteProviderFork = () => deleteCodexThread(forkedConversationId);
  } else {
    throw new Error(`Runtime does not support context restore: ${source.runtime ?? 'unknown'}`);
  }

  try {
    const lastInteractedAt = new Date().toISOString();
    const [row] = await db
      .insert(conversations)
      .values({
        id: forkedConversationId,
        projectId: source.projectId,
        taskId: source.taskId,
        title: `${source.title} · #${params.promptIndex + 1}`,
        titleSource: 'yoda',
        runtime: source.runtime,
        config: source.config,
        isInitialConversation: false,
        createdAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        lastInteractedAt,
      })
      .returning();
    if (!row) {
      throw new Error('Failed to persist forked conversation.');
    }

    const conversation = mapConversationRowToConversation(row);
    try {
      await task.conversations.startSession(conversation, params.initialSize, true);
    } catch (error) {
      // The restored provider context and DB record are already durable. Treat
      // a launch failure as a recoverable created session so a renderer retry
      // cannot duplicate the fork; the user can resume it from the new tab.
      log.warn('forkConversationAtPrompt: restored context but failed to start session', {
        conversationId: conversation.id,
        error: String(error),
      });
      conversation.resume = true;
    }

    try {
      await db.update(tasks).set({ lastInteractedAt }).where(eq(tasks.id, source.taskId));
    } catch (error) {
      log.warn('forkConversationAtPrompt: failed to update task interaction time', {
        taskId: source.taskId,
        error: String(error),
      });
    }

    conversationEvents._emit('conversation:created', conversation);
    return conversation;
  } catch (error) {
    try {
      await deleteProviderFork();
    } catch (cleanupError) {
      log.warn('forkConversationAtPrompt: failed to clean up provider fork', {
        conversationId: forkedConversationId,
        error: String(cleanupError),
      });
    }
    throw error;
  }
}

function contextForkKey(params: ForkConversationAtPromptParams): string {
  const targetId =
    params.target.kind === 'claude-message' ? params.target.messageId : params.target.turnId;
  return `${params.projectId}:${params.taskId}:${params.conversationId}:${params.promptIndex}:${params.target.kind}:${targetId}`;
}

function assertPromptTarget(
  actual: SessionContextRestoreTarget | undefined,
  requested: SessionContextRestoreTarget
): void {
  if (!actual || !sameRestoreTarget(actual, requested)) {
    throw new Error('Prompt restore target is invalid or no longer available.');
  }
}

function sameRestoreTarget(
  left: SessionContextRestoreTarget,
  right: SessionContextRestoreTarget
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'claude-message' && right.kind === 'claude-message') {
    return left.messageId === right.messageId;
  }
  return left.kind === 'codex-turn' && right.kind === 'codex-turn' && left.turnId === right.turnId;
}
