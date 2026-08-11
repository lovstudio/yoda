import { and, eq } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { hasExternalCodexThreadWriter } from './codex-thread-writer';
import {
  getConversationHydrationBarrier,
  wasConversationHydrationCancelled,
} from './conversation-hydration-barrier';
import { withConversationOperation } from './conversation-operation-lock';
import {
  hydratedConversationStart,
  shouldClearPendingInitialPromptAfterStart,
} from './pending-initial-prompt';
import { clearPendingInitialPrompt } from './pending-initial-prompt-store';
import { reconcileConversationPermission } from './reconcile-conversation-permission';
import { mapConversationRowToConversation } from './utils';

const inFlightResumes = new Map<string, Promise<boolean>>();

export async function resumeConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number }
): Promise<boolean> {
  const sessionKey = `${projectId}:${taskId}:${conversationId}`;
  const existing = inFlightResumes.get(sessionKey);
  if (existing) return existing;

  const operation = (async () => {
    const hydration = getConversationHydrationBarrier(projectId, taskId, conversationId);
    if (hydration) {
      try {
        await hydration;
      } catch (error) {
        log.warn('resumeConversation: startup hydration failed before explicit resume', {
          projectId,
          taskId,
          conversationId,
          error: String(error),
        });
      }
      if (wasConversationHydrationCancelled(hydration)) return false;
    }
    const registrationEpoch = ptySessionRegistry.beginRegistration(
      makePtySessionId(projectId, taskId, conversationId)
    );
    try {
      return await withConversationOperation({ projectId, id: conversationId }, async () => {
        const [row] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.projectId, projectId),
              eq(conversations.taskId, taskId)
            )
          )
          .limit(1);

        if (!row || row.archivedAt) return false;

        const task = resolveTask(projectId, taskId);
        if (!task) {
          throw new Error(`Task not provisioned: ${taskId}`);
        }

        if (!ptySessionRegistry.isRegistrationCurrent(sessionKey, registrationEpoch)) return false;
        const conversation = await reconcileConversationPermission(
          mapConversationRowToConversation(row, true),
          row.config
        );
        if (
          task.conversations
            .getActiveSessions()
            .some((session) => session.conversationId === conversationId)
        ) {
          return true;
        }
        if (await hasExternalCodexThreadWriter(conversation.sessionSource)) {
          log.info('resumeConversation: imported Codex thread is active in another process', {
            projectId,
            taskId,
            conversationId,
            threadId: conversation.sessionSource?.sessionId,
          });
          return false;
        }
        if (!ptySessionRegistry.isRegistrationCurrent(sessionKey, registrationEpoch)) return false;
        const pending = conversation.pendingInitialPrompt;
        const start = hydratedConversationStart(conversation);
        await task.conversations.startSession(
          conversation,
          initialSize,
          start.isResuming,
          start.initialPrompt,
          undefined,
          start.imagePaths,
          { model: start.model, reasoningEffort: start.reasoningEffort }
        );
        if (
          pending &&
          shouldClearPendingInitialPromptAfterStart(task.conversations, conversation.runtimeId)
        ) {
          await clearPendingInitialPrompt(conversation.id, {
            projectId: conversation.projectId,
            taskId: conversation.taskId,
            deliveryToken: pending.deliveryToken,
          });
        }
        return task.conversations
          .getActiveSessions()
          .some((session) => session.conversationId === conversationId);
      });
    } finally {
      ptySessionRegistry.cancelRegistration(sessionKey, registrationEpoch);
    }
  })();

  const tracked = operation.finally(() => {
    if (inFlightResumes.get(sessionKey) === tracked) inFlightResumes.delete(sessionKey);
  });
  inFlightResumes.set(sessionKey, tracked);
  return tracked;
}
