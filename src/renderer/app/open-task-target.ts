import { when } from 'mobx';
import type { DeepLinkTarget } from '@shared/deep-links';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { log } from '@renderer/utils/logger';

export type OpenTaskTarget = Pick<
  DeepLinkTarget,
  'projectId' | 'taskId' | 'conversationId' | 'promptId' | 'promptIndex'
>;

export function openTaskTarget(
  target: OpenTaskTarget,
  navigate: NavigateFnTyped,
  disposers?: Set<() => void>
): void {
  const { projectId, taskId, conversationId, promptId, promptIndex } = target;
  if (!taskId) {
    navigate('project', { projectId });
    return;
  }
  navigate('task', { projectId, taskId });
  if (!conversationId) return;

  const dispose = when(
    () => Boolean(asProvisioned(getTaskStore(projectId, taskId))),
    () => {
      disposers?.delete(dispose);
      const provisioned = asProvisioned(getTaskStore(projectId, taskId));
      if (!provisioned) return;

      void provisioned.conversations
        .ensureConversation(conversationId)
        .then((found) => {
          if (!found) return;

          provisioned.taskView.tabManager.openConversation(conversationId);
          provisioned.taskView.setFocusedRegion('main');

          if (promptId || promptIndex) {
            // Prompts now live in the dedicated Conversation chapter; open it.
            provisioned.taskView.setSidebarCollapsed(false);
            provisioned.taskView.setSidebarTab('conversations');
          }
        })
        .catch((error: unknown) => {
          log.warn('openTaskTarget: failed to open conversation target', {
            projectId,
            taskId,
            conversationId,
            error,
          });
        });
    },
    { timeout: 10_000 }
  );
  disposers?.add(dispose);
}
