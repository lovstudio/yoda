import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Conversation } from '@shared/conversations';
import { conversationMovedChannel } from '@shared/events/conversationEvents';
import { db } from '@main/db/client';
import { conversations, roomMembers, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { conversationEvents } from './conversation-events';
import { cancelConversationHydrationBarrier } from './conversation-hydration-barrier';
import { withConversationOperation } from './conversation-operation-lock';
import {
  hydratedConversationStart,
  shouldClearPendingInitialPromptAfterStart,
} from './pending-initial-prompt';
import {
  clearPendingInitialPrompt,
  stabilizePendingInitialPromptDelivery,
} from './pending-initial-prompt-store';
import type { ConversationProvider } from './types';
import { mapConversationRowToConversation } from './utils';

const pendingMoves = new Map<string, Promise<Conversation>>();

class ConversationMoveConflictError extends Error {}

async function startPersistedConversation(
  provider: ConversationProvider,
  conversation: Conversation
): Promise<void> {
  const pending = conversation.pendingInitialPrompt;
  if (!pending) {
    await provider.startSession(conversation, undefined, true);
    return;
  }
  const start = hydratedConversationStart(conversation);
  await provider.startSession(
    conversation,
    undefined,
    start.isResuming,
    start.initialPrompt,
    undefined,
    start.imagePaths,
    { model: start.model, reasoningEffort: start.reasoningEffort }
  );
  if (pending && shouldClearPendingInitialPromptAfterStart(provider, conversation.runtimeId)) {
    await clearPendingInitialPrompt(conversation.id, {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      deliveryToken: pending.deliveryToken,
    });
  }
}

/** Move one live session between tasks without allowing a cross-project re-home. */
export function moveConversation(
  projectId: string,
  sourceTaskId: string,
  targetTaskId: string,
  conversationId: string
): Promise<Conversation> {
  const existing = pendingMoves.get(conversationId);
  if (existing) return existing;

  const pending = withConversationOperation({ projectId, id: conversationId }, () =>
    performMove(projectId, sourceTaskId, targetTaskId, conversationId)
  ).finally(() => {
    if (pendingMoves.get(conversationId) === pending) pendingMoves.delete(conversationId);
  });
  pendingMoves.set(conversationId, pending);
  return pending;
}

async function performMove(
  projectId: string,
  sourceTaskId: string,
  targetTaskId: string,
  conversationId: string
): Promise<Conversation> {
  if (sourceTaskId === targetTaskId) {
    throw new Error('Source and target tasks must be different.');
  }

  const [[source], [target], [roomMember]] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, sourceTaskId),
          isNull(conversations.archivedAt)
        )
      )
      .limit(1),
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, targetTaskId),
          eq(tasks.projectId, projectId),
          isNull(tasks.archivedAt),
          isNull(tasks.archiveRequestedAt)
        )
      )
      .limit(1),
    db
      .select({ id: roomMembers.id })
      .from(roomMembers)
      .where(eq(roomMembers.conversationId, conversationId))
      .limit(1),
  ]);

  if (!source) throw new Error(`Conversation not found: ${conversationId}`);
  if (!target) throw new Error(`Target task not found or unavailable: ${targetTaskId}`);
  if (roomMember) throw new Error('Agent Room member sessions cannot be moved between tasks.');

  let sourceConversation = mapConversationRowToConversation(source, true);
  if (sourceConversation.pendingInitialPrompt?.attemptStartedAtMs !== undefined) {
    throw new Error('Resume the pending first prompt before moving this conversation.');
  }
  cancelConversationHydrationBarrier(projectId, sourceTaskId, conversationId);

  const stabilized = await stabilizePendingInitialPromptDelivery(
    conversationId,
    projectId,
    sourceTaskId
  );
  if (!stabilized)
    throw new Error(`Conversation changed before it could be moved: ${conversationId}`);
  if (stabilized.pendingInitialPrompt?.attemptStartedAtMs !== undefined) {
    throw new Error('Resume the pending first prompt before moving this conversation.');
  }
  sourceConversation = mapConversationRowToConversation(
    { ...source, config: stabilized.config },
    true
  );

  const sourceTask = resolveTask(projectId, sourceTaskId);
  await sourceTask?.conversations.stopSession(conversationId);

  let updated: typeof source | undefined;
  try {
    [updated] = await db
      .update(conversations)
      .set({ taskId: targetTaskId, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, sourceTaskId),
          stabilized.config === null
            ? isNull(conversations.config)
            : eq(conversations.config, stabilized.config),
          isNull(conversations.archivedAt)
        )
      )
      .returning();
    if (!updated) {
      throw new ConversationMoveConflictError(`Conversation moved concurrently: ${conversationId}`);
    }
  } catch (error) {
    if (sourceTask && !(error instanceof ConversationMoveConflictError)) {
      await startPersistedConversation(sourceTask.conversations, sourceConversation).catch(
        (resumeError) => {
          log.warn('moveConversation: failed to restore source session after persistence error', {
            projectId,
            sourceTaskId,
            conversationId,
            error: String(resumeError),
          });
        }
      );
    }
    throw error;
  }

  if (updated.lastInteractedAt) {
    await db
      .update(tasks)
      .set({ lastInteractedAt: updated.lastInteractedAt, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, targetTaskId))
      .catch((error: unknown) => {
        log.warn('moveConversation: failed to update target task activity', {
          targetTaskId,
          conversationId,
          error: String(error),
        });
      });
  }

  const conversation = mapConversationRowToConversation(updated, true);
  const targetTask = resolveTask(projectId, targetTaskId);
  if (targetTask) {
    await startPersistedConversation(targetTask.conversations, conversation).catch((error) => {
      // Ownership is already durable. A later task open/resume can retry the
      // provider session, so do not roll the database back into the stopped task.
      log.warn('moveConversation: target session resume failed', {
        projectId,
        sourceTaskId,
        targetTaskId,
        conversationId,
        error: String(error),
      });
    });
  }

  conversationEvents._emit('conversation:moved', conversation, sourceTaskId, targetTaskId);
  events.emit(conversationMovedChannel, { conversation, sourceTaskId, targetTaskId });
  return conversation;
}
