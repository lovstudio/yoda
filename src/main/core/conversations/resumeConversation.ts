import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

const inFlightResumes = new Map<string, Promise<void>>();

export async function resumeConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number }
): Promise<void> {
  const sessionKey = `${projectId}:${taskId}:${conversationId}`;
  const existing = inFlightResumes.get(sessionKey);
  if (existing) return existing;

  const promise = (async () => {
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

    const conversation = mapConversationRowToConversation(row, true);
    await task.conversations.startSession(conversation, initialSize, true);
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
