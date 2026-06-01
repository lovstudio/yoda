import { when } from 'mobx';
import { useEffect } from 'react';
import type { DeepLinkTarget } from '@shared/deep-links';
import {
  deepLinkOpenChannel,
  menuOpenSettingsChannel,
  notificationFocusTaskChannel,
} from '@shared/events/appEvents';
import { contextPanelFocusStore } from '@renderer/features/tasks/context-panel-focus';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { log } from '@renderer/utils/logger';

type OpenTaskTarget = Pick<
  DeepLinkTarget,
  'projectId' | 'taskId' | 'conversationId' | 'promptId' | 'promptIndex'
>;

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      const shouldOpen = onOpenSettings?.() ?? true;
      if (shouldOpen === false) return;
      if (currentView === 'settings') return;

      navigate('settings');
    });
  }, [navigate, onOpenSettings, currentView]);

  useEffect(() => {
    const disposers = new Set<() => void>();

    const openTaskTarget = (target: OpenTaskTarget) => {
      const { projectId, taskId, conversationId, promptId, promptIndex } = target;
      navigate('task', { projectId, taskId });
      if (!conversationId) return;

      const dispose = when(
        () => Boolean(asProvisioned(getTaskStore(projectId, taskId))),
        () => {
          disposers.delete(dispose);
          const provisioned = asProvisioned(getTaskStore(projectId, taskId));
          if (!provisioned) return;

          void provisioned.conversations
            .load()
            .then(() => {
              if (!provisioned.conversations.conversations.has(conversationId)) return;

              provisioned.taskView.tabManager.openConversation(conversationId);
              provisioned.taskView.setFocusedRegion('main');

              if (promptId || promptIndex) {
                provisioned.taskView.setSidebarCollapsed(false);
                provisioned.taskView.setSidebarTab('context');
                contextPanelFocusStore.focusPrompt({
                  sessionId: conversationId,
                  promptId,
                  promptIndex,
                });
              }
            })
            .catch((error: unknown) => {
              log.warn('AppMenuEvents: failed to open conversation target', {
                projectId,
                taskId,
                conversationId,
                error,
              });
            });
        },
        { timeout: 10_000 }
      );
      disposers.add(dispose);
    };

    const unlistenNotifications = events.on(notificationFocusTaskChannel, openTaskTarget);
    const unlistenDeepLinks = events.on(deepLinkOpenChannel, openTaskTarget);

    void rpc.app
      .consumePendingDeepLinks()
      .then((targets) => {
        for (const target of targets) openTaskTarget(target);
      })
      .catch((error: unknown) => {
        log.warn('AppMenuEvents: failed to consume pending deep links', { error });
      });

    return () => {
      unlistenNotifications();
      unlistenDeepLinks();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
    };
  }, [navigate]);

  return null;
}
