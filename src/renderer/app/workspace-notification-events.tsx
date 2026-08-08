import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationCreatedChannel } from '@shared/events/appEvents';
import { events } from '@renderer/lib/ipc';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';

export function WorkspaceNotificationEvents() {
  const { t } = useTranslation();

  useEffect(
    () =>
      events.on(notificationCreatedChannel, (notification) => {
        if (!notification.requiresAction) return;
        const description = notification.messageKey
          ? t(`workspaceRuntime.notifications.system.${notification.messageKey}`)
          : notification.description;
        workspaceNotificationStore.enqueue({
          title: notification.title,
          description,
          details: [description, notification.details].filter(Boolean).join('\n\n'),
          kind: notification.kind,
          source: notification.source,
          target: notification.target,
        });
      }),
    [t]
  );

  return null;
}
