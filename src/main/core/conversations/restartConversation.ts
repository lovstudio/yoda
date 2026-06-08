import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapConversationRowToConversation } from './utils';

export async function restartConversation(
  projectId: string,
  taskId: string,
  conversationId: string,
  initialSize?: { cols: number; rows: number },
  /** Override tmux for the restarted session only; omit to keep the task default. */
  tmuxOverride?: boolean
): Promise<void> {
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
  await task.conversations.stopSession(conversationId);
  await task.conversations.startSession(conversation, initialSize, true, undefined, tmuxOverride);
}
