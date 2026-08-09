import type { NotificationSettings } from './app-settings';
import type { AgentEvent } from './events/agentEvents';

export type NotificationDeliveryMode = 'never' | 'unfocused' | 'always';

export type NotificationSettingsPatch = Partial<
  Pick<
    NotificationSettings,
    | 'enabled'
    | 'sound'
    | 'osNotifications'
    | 'soundFocusMode'
    | 'permissionNotifications'
    | 'questionNotifications'
  >
>;

/**
 * Converts the legacy sound + focus fields into the three choices used by the
 * notification settings UI. Keeping this mapping in one place lets old
 * settings continue to work after the UI stops exposing the implementation
 * details separately.
 */
export function getNotificationDeliveryMode(
  settings: NotificationSettingsPatch | undefined
): NotificationDeliveryMode {
  if (settings?.sound === false) return 'never';
  return settings?.soundFocusMode ?? 'unfocused';
}

function legacySystemNotificationsEnabled(settings: NotificationSettingsPatch): boolean {
  return (settings.enabled ?? true) && (settings.osNotifications ?? true);
}

export function arePermissionNotificationsEnabled(
  settings: NotificationSettingsPatch | undefined
): boolean {
  if (!settings) return true;
  return settings.permissionNotifications ?? legacySystemNotificationsEnabled(settings);
}

export function areQuestionNotificationsEnabled(
  settings: NotificationSettingsPatch | undefined
): boolean {
  if (!settings) return true;
  return settings.questionNotifications ?? legacySystemNotificationsEnabled(settings);
}

/** Whether an agent event may produce an OS notification for this event type. */
export function isAgentNotificationEnabled(
  event: Pick<AgentEvent, 'type' | 'payload'>,
  settings: NotificationSettingsPatch | undefined
): boolean {
  if (event.type === 'notification' && event.payload.notificationType === 'permission_prompt') {
    return arePermissionNotificationsEnabled(settings);
  }
  return areQuestionNotificationsEnabled(settings);
}
