import { useEffect } from 'react';
import { notificationCreatedChannel, shouldRetainAppNotification } from '@shared/events/appEvents';
import { events } from '@renderer/lib/ipc';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';

export function WorkspaceNotificationEvents() {
  useEffect(
    () =>
      events.on(notificationCreatedChannel, (notification) => {
        if (!shouldRetainAppNotification(notification)) return;
        const { description } = notification;
        const details = [description, notification.details].filter(Boolean).join('\n\n');
        const existing = notification.notificationKey
          ? workspaceNotificationStore.getByDedupeKey(notification.notificationKey)
          : undefined;
        if (notification.status === 'resolved') {
          if (existing) {
            workspaceNotificationStore.resolve(existing.id, {
              title: notification.title,
              description,
              details,
              kind: notification.kind,
            });
          }
          return;
        }
        workspaceNotificationStore.enqueue(
          {
            title: notification.title,
            description,
            details,
            kind: notification.kind,
            source: notification.source,
            reason: notification.reason ?? 'error',
            dedupeKey: notification.notificationKey,
            target: notification.target,
          },
          existing?.id
        );
      }),
    []
  );

  return null;
}
