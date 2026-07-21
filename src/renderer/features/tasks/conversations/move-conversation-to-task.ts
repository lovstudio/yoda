import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

export async function moveConversationToTask({
  projectId,
  sourceTaskId,
  targetTaskId,
  targetTaskName,
  conversationId,
}: {
  projectId: string;
  sourceTaskId: string;
  targetTaskId: string;
  targetTaskName: string;
  conversationId: string;
}): Promise<boolean> {
  try {
    await rpc.conversations.moveConversation(projectId, sourceTaskId, targetTaskId, conversationId);
    toast({
      title: i18n.t('tasks.conversations.moveSuccess', { task: targetTaskName }),
    });
    return true;
  } catch (error) {
    log.warn('moveConversationToTask: failed to move conversation', {
      projectId,
      sourceTaskId,
      targetTaskId,
      conversationId,
      error,
    });
    toast({
      title: i18n.t('tasks.conversations.moveFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    });
    return false;
  }
}
