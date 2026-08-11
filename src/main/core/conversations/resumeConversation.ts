import { and, eq } from 'drizzle-orm';
import { makePtySessionId } from '@shared/ptySessionId';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveTask } from '../projects/utils';
import { hasExternalCodexThreadWriter } from './codex-thread-writer';
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
  const registrationEpoch = ptySessionRegistry.beginRegistration(
    makePtySessionId(projectId, taskId, conversationId)
  );

  const promise = (async () => {
    try {
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

      if (!row) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }

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
      await task.conversations.startSession(conversation, initialSize, true);
      return task.conversations
        .getActiveSessions()
        .some((session) => session.conversationId === conversationId);
    } finally {
      ptySessionRegistry.cancelRegistration(sessionKey, registrationEpoch);
    }
  })();

  inFlightResumes.set(sessionKey, promise);
  promise.then(
    () => {
      if (inFlightResumes.get(sessionKey) === promise) {
        inFlightResumes.delete(sessionKey);
      }
    },
    () => {
      if (inFlightResumes.get(sessionKey) === promise) {
        inFlightResumes.delete(sessionKey);
      }
    }
  );

  return promise;
}
