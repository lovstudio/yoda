import { describe, expect, it } from 'vitest';
import {
  arePermissionNotificationsEnabled,
  areQuestionNotificationsEnabled,
  getNotificationDeliveryMode,
  isAgentNotificationEnabled,
} from './notification-settings';

const legacySettings = {
  enabled: true,
  sound: true,
  osNotifications: true,
  soundFocusMode: 'unfocused' as const,
};

describe('notification settings', () => {
  it('maps legacy sound settings to the Codex-style delivery choices', () => {
    expect(getNotificationDeliveryMode(legacySettings)).toBe('unfocused');
    expect(getNotificationDeliveryMode({ ...legacySettings, sound: false })).toBe('never');
    expect(getNotificationDeliveryMode({ ...legacySettings, soundFocusMode: 'always' })).toBe(
      'always'
    );
  });

  it('keeps legacy master settings effective until per-event values are set', () => {
    const disabled = { ...legacySettings, enabled: false };
    expect(arePermissionNotificationsEnabled(disabled)).toBe(false);
    expect(areQuestionNotificationsEnabled(disabled)).toBe(false);
    expect(arePermissionNotificationsEnabled({ ...disabled, permissionNotifications: true })).toBe(
      true
    );
    expect(areQuestionNotificationsEnabled({ ...disabled, questionNotifications: true })).toBe(
      true
    );
  });

  it('routes permission and question events to their own settings', () => {
    const settings = {
      ...legacySettings,
      permissionNotifications: false,
      questionNotifications: true,
    };
    expect(
      isAgentNotificationEnabled(
        { type: 'notification', payload: { notificationType: 'permission_prompt' } },
        settings
      )
    ).toBe(false);
    expect(
      isAgentNotificationEnabled(
        { type: 'notification', payload: { notificationType: 'elicitation_dialog' } },
        settings
      )
    ).toBe(true);
    expect(isAgentNotificationEnabled({ type: 'awaiting-input', payload: {} }, settings)).toBe(
      true
    );
  });
});
