import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  arePermissionNotificationsEnabled,
  areQuestionNotificationsEnabled,
  getNotificationDeliveryMode,
  type NotificationDeliveryMode,
} from '@shared/notification-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { setSoundSettings } from '@renderer/utils/soundPlayer';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const NotificationSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: notifications,
    update,
    isLoading: loading,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('notifications');
  const completionMode = getNotificationDeliveryMode(notifications);
  const permissionNotifications = arePermissionNotificationsEnabled(notifications);
  const questionNotifications = areQuestionNotificationsEnabled(notifications);

  useEffect(() => {
    setSoundSettings({
      sound: notifications?.sound,
      soundFocusMode: notifications?.soundFocusMode,
    });
  }, [notifications?.sound, notifications?.soundFocusMode]);

  const resetCompletionSettings = () => {
    resetField('sound');
    resetField('soundFocusMode');
  };

  const updateCompletionMode = (next: NotificationDeliveryMode) => {
    if (next === 'never') {
      update({ sound: false });
      return;
    }
    update({ sound: true, soundFocusMode: next });
  };

  return (
    <div
      data-testid="notification-settings-card"
      className="@container overflow-hidden rounded-xl border border-border/70 bg-background"
    >
      <div className="flex flex-col divide-y divide-border/70">
        <div className="px-4 py-4 @max-md:px-3 @max-md:py-3.5">
          <SettingRow
            title={t('settings.notifications.turnCompletion')}
            description={t('settings.notifications.turnCompletionDescription')}
            control={
              <>
                <ResetToDefaultButton
                  visible={isFieldOverridden('sound') || isFieldOverridden('soundFocusMode')}
                  defaultLabel={t('settings.notifications.deliveryModes.unfocused')}
                  onReset={resetCompletionSettings}
                  disabled={loading}
                />
                <Select
                  value={completionMode}
                  disabled={loading}
                  onValueChange={(next) => updateCompletionMode(next as NotificationDeliveryMode)}
                >
                  <SelectTrigger
                    className="w-auto min-w-0 shrink-0 gap-2 [&>span]:line-clamp-none"
                    aria-label={t('settings.notifications.turnCompletion')}
                  >
                    <SelectValue>
                      {t(`settings.notifications.deliveryModes.${completionMode}`)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-[13rem]">
                    <SelectItem value="never">
                      {t('settings.notifications.deliveryModes.never')}
                    </SelectItem>
                    <SelectItem value="unfocused">
                      {t('settings.notifications.deliveryModes.unfocused')}
                    </SelectItem>
                    <SelectItem value="always">
                      {t('settings.notifications.deliveryModes.always')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
          />
        </div>

        <div className="px-4 py-4 @max-md:px-3 @max-md:py-3.5">
          <SettingRow
            title={t('settings.notifications.permissionNotifications')}
            description={t('settings.notifications.permissionNotificationsDescription')}
            control={
              <>
                <ResetToDefaultButton
                  visible={isFieldOverridden('permissionNotifications')}
                  defaultLabel={t('settings.notifications.enabled')}
                  onReset={() => resetField('permissionNotifications')}
                  disabled={loading}
                />
                <Switch
                  checked={permissionNotifications}
                  disabled={loading}
                  aria-label={t('settings.notifications.permissionNotifications')}
                  onCheckedChange={(next) => update({ permissionNotifications: next })}
                />
              </>
            }
          />
        </div>

        <div className="px-4 py-4 @max-md:px-3 @max-md:py-3.5">
          <SettingRow
            title={t('settings.notifications.questionNotifications')}
            description={t('settings.notifications.questionNotificationsDescription')}
            control={
              <>
                <ResetToDefaultButton
                  visible={isFieldOverridden('questionNotifications')}
                  defaultLabel={t('settings.notifications.enabled')}
                  onReset={() => resetField('questionNotifications')}
                  disabled={loading}
                />
                <Switch
                  checked={questionNotifications}
                  disabled={loading}
                  aria-label={t('settings.notifications.questionNotifications')}
                  onCheckedChange={(next) => update({ questionNotifications: next })}
                />
              </>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default NotificationSettingsCard;
