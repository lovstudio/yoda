import type { ConversationSessionInfo } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { resumeConversation } from '@main/core/conversations/resumeConversation';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { provisionTask } from '@main/core/tasks/provisionTask';
import { taskManager } from '@main/core/tasks/task-manager';

export type MobileSessionAvailability = {
  running: boolean;
  acceptsInput: boolean;
  resumable: boolean;
};

export function resolveMobileSessionAvailability(
  sessionInfo: Pick<ConversationSessionInfo, 'resumeCommand' | 'running'> | null,
  hasRegisteredPty: boolean
): MobileSessionAvailability {
  const running = Boolean(sessionInfo?.running || hasRegisteredPty);
  return {
    running,
    acceptsInput: running,
    resumable: Boolean(sessionInfo?.resumeCommand),
  };
}

function hasActiveInputSession({
  projectId,
  taskId,
  conversationId,
}: {
  projectId: string;
  taskId: string;
  conversationId: string;
}): boolean {
  const sessionId = makePtySessionId(projectId, taskId, conversationId);
  if (ptySessionRegistry.get(sessionId)) return true;

  return Boolean(
    taskManager
      .getTask(taskId)
      ?.conversations.getActiveSessions()
      .some((session) => session.conversationId === conversationId)
  );
}

/**
 * Restores the task provider and its original Agent conversation before mobile input is injected.
 * The owning project must already be open so provisionTask can reuse the canonical task lifecycle.
 */
export async function ensureMobileConversationInputSession(input: {
  projectId: string;
  taskId: string;
  conversationId: string;
}): Promise<boolean> {
  if (hasActiveInputSession(input)) return true;

  await provisionTask(input.taskId);
  if (hasActiveInputSession(input)) return true;

  return resumeConversation(input.projectId, input.taskId, input.conversationId);
}
