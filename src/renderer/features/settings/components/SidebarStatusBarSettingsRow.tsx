import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

export default function SidebarStatusBarSettingsRow() {
  const { t } = useTranslation();
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');
  const primary = interfaceSettings?.sidebarStatusBarPrimary ?? 'product';
  const disabled = isLoading || isSaving;

  return (
    <SettingRow
      title={t('settings.interfaceTab.sidebarStatusBarPrimary')}
      description={t('settings.interfaceTab.sidebarStatusBarPrimaryDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('sidebarStatusBarPrimary')}
            defaultLabel={t('settings.interfaceTab.sidebarStatusBarProduct')}
            onReset={() => resetField('sidebarStatusBarPrimary')}
            disabled={disabled}
          />
          <Select
            value={primary}
            onValueChange={(value) => {
              if (value === 'product' || value === 'account') {
                update({ sidebarStatusBarPrimary: value });
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger
              aria-label={t('settings.interfaceTab.sidebarStatusBarPrimary')}
              className="h-8 w-36"
            >
              <SelectValue>
                {(value: string | null) =>
                  value === 'account'
                    ? t('settings.interfaceTab.sidebarStatusBarAccount')
                    : t('settings.interfaceTab.sidebarStatusBarProduct')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="product">
                {t('settings.interfaceTab.sidebarStatusBarProduct')}
              </SelectItem>
              <SelectItem value="account">
                {t('settings.interfaceTab.sidebarStatusBarAccount')}
              </SelectItem>
            </SelectContent>
          </Select>
        </>
      }
    />
  );
}
