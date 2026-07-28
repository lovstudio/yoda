import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeSessionPrompt, Conversation } from '@shared/conversations';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

export type ConversationPromptLocation = {
  conversation: Conversation;
  prompt: ClaudeSessionPrompt;
  /** Zero-based index in the source conversation's complete transcript. */
  promptIndex: number;
};

export type RestoringConversationPrompt = {
  conversationId: string;
  promptId: string;
  promptIndex: number;
};

/**
 * Shared execution path for every surface that forks a prompt checkpoint.
 * Callers own confirmation, navigation and success/error messaging.
 */
export async function forkConversationAtPromptIntoNewTab(
  provisionedTask: ProvisionedTask,
  { conversation, prompt, promptIndex }: ConversationPromptLocation
): Promise<Conversation | null> {
  if (!prompt.restoreTarget) return null;
  const initialSize =
    provisionedTask.conversations.conversations.get(conversation.id)?.session.pty?.lastSentDims ??
    undefined;
  const fork = await provisionedTask.conversations.forkConversationAtPrompt({
    projectId: conversation.projectId,
    taskId: conversation.taskId,
    conversationId: conversation.id,
    promptIndex,
    target: prompt.restoreTarget,
    initialSize,
  });
  provisionedTask.taskView.tabManager.openConversation(fork.id);
  provisionedTask.taskView.setFocusedRegion('main');
  return fork;
}

/**
 * Shared context-checkpoint action for every prompt-history surface. The source
 * conversation is explicit because a tree can contain checkpoints from several
 * sibling (and archived) conversations at once.
 */
export function useConversationPromptRestore(): {
  restoringPrompt: RestoringConversationPrompt | null;
  requestRestorePrompt: (location: ConversationPromptLocation) => void;
} {
  const { t } = useTranslation();
  const provisionedTask = useProvisionedTask();
  const showRestoreConfirm = useShowModal('confirmActionModal');
  const pendingRef = useRef(false);
  const [restoringPrompt, setRestoringPrompt] = useState<RestoringConversationPrompt | null>(null);

  const restorePrompt = useCallback(
    async ({ conversation, prompt, promptIndex }: ConversationPromptLocation) => {
      if (!prompt.restoreTarget || pendingRef.current) return;
      if (
        provisionedTask.conversations.isContextForkPending({
          conversationId: conversation.id,
          promptIndex,
          target: prompt.restoreTarget,
        })
      ) {
        return;
      }

      pendingRef.current = true;
      setRestoringPrompt({
        conversationId: conversation.id,
        promptId: prompt.id,
        promptIndex,
      });
      try {
        await forkConversationAtPromptIntoNewTab(provisionedTask, {
          conversation,
          prompt,
          promptIndex,
        });
        toast({ title: t('tasks.sessionInfo.restoreContextSuccess') });
      } catch (error) {
        toast({
          title: t('tasks.sessionInfo.restoreContextFailed'),
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
          debugInfo: error,
        });
      } finally {
        pendingRef.current = false;
        setRestoringPrompt(null);
      }
    },
    [provisionedTask, t]
  );

  const requestRestorePrompt = useCallback(
    (location: ConversationPromptLocation) => {
      const { conversation, prompt, promptIndex } = location;
      if (!prompt.restoreTarget || pendingRef.current) return;
      if (
        provisionedTask.conversations.isContextForkPending({
          conversationId: conversation.id,
          promptIndex,
          target: prompt.restoreTarget,
        })
      ) {
        return;
      }

      showRestoreConfirm({
        title: t('tasks.sessionInfo.restoreContextTitle', { index: promptIndex + 1 }),
        description: t('tasks.sessionInfo.restoreContextDescription'),
        confirmLabel: t('tasks.sessionInfo.restoreContextConfirm'),
        variant: 'default',
        onSuccess: () => void restorePrompt(location),
      });
    },
    [provisionedTask.conversations, restorePrompt, showRestoreConfirm, t]
  );

  return { restoringPrompt, requestRestorePrompt };
}
