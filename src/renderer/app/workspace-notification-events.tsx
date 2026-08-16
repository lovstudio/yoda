import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationCreatedChannel, shouldRetainAppNotification } from '@shared/events/appEvents';
import { DEFAULT_NOTIFICATION_CENTER_SOURCES } from '@shared/notifications';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { events } from '@renderer/lib/ipc';
import { workspaceNotificationStore } from '@renderer/lib/stores/notification-store';

export function WorkspaceNotificationEvents() {
  const { t } = useTranslation();
  const { value: notificationSettings } = useAppSettingsKey('notifications');
  const retainedSources = notificationSettings?.notificationCenterSources;

  // Toasts and renderer errors are recorded outside React, so the configured
  // intake filter is mirrored into the store instead of read per call site.
  useEffect(() => {
    workspaceNotificationStore.setRetainedSources(
      retainedSources ?? DEFAULT_NOTIFICATION_CENTER_SOURCES
    );
  }, [retainedSources]);

  useEffect(
    () =>
      events.on(notificationCreatedChannel, (notification) => {
        if (!shouldRetainAppNotification(notification)) return;
        const description = notification.messageKey
          ? t(`workspaceRuntime.notifications.system.${notification.messageKey}`)
          : notification.description;
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
    [t]
  );

  return null;
}
