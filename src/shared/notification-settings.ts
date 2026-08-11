import type { NotificationSettings } from './app-settings';
import { agentEventRequiresUserAction, type AgentEvent } from './events/agentEvents';

export type NotificationDeliveryMode = 'never' | 'unfocused' | 'always';
export type AgentNotificationKind = 'completion' | 'permission' | 'question';

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
  if (settings?.enabled === false) return 'never';
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

export function getAgentNotificationKind(
  event: Pick<AgentEvent, 'type' | 'payload'>
): AgentNotificationKind | null {
  if (event.type === 'stop') return 'completion';
  if (event.payload.notificationType === 'permission_prompt') return 'permission';
  if (agentEventRequiresUserAction(event)) return 'question';
  return null;
}

/** Whether an agent event may produce an OS notification for this event type. */
export function isAgentNotificationEnabled(
  event: Pick<AgentEvent, 'type' | 'payload'>,
  settings: NotificationSettingsPatch | undefined
): boolean {
  switch (getAgentNotificationKind(event)) {
    case 'completion':
      return getNotificationDeliveryMode(settings) !== 'never';
    case 'permission':
      return arePermissionNotificationsEnabled(settings);
    case 'question':
      return areQuestionNotificationsEnabled(settings);
    default:
      return false;
  }
}

/** Whether an OS notification should be shown, including the focus policy. */
export function shouldShowAgentNotification(
  event: Pick<AgentEvent, 'type' | 'payload'>,
  settings: NotificationSettingsPatch | undefined,
  appFocused: boolean
): boolean {
  const kind = getAgentNotificationKind(event);
  if (!kind || !isAgentNotificationEnabled(event, settings)) return false;
  if (kind === 'completion') {
    return getNotificationDeliveryMode(settings) === 'always' || !appFocused;
  }
  return !appFocused;
}
