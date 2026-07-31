import { useTranslation } from 'react-i18next';
import { ResetToDefaultButton } from '@renderer/features/settings/components/ResetToDefaultButton';
import { SettingRow } from '@renderer/features/settings/components/SettingRow';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Switch } from '@renderer/lib/ui/switch';

export function AutoTrustWorktreesControl({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const disabled = taskSettings.loading || taskSettings.saving;
  const overridden = taskSettings.isFieldOverridden('autoTrustWorktrees');
  const label = t('settings.tasks.autoTrustWorktrees');
  const title = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={compact ? 'text-xs text-foreground' : undefined}>{label}</span>
      <InfoTooltip
        label={t('settings.tasks.autoTrustWorktreesInfoLabel')}
        content={t('settings.tasks.autoTrustWorktreesInfo')}
      />
    </div>
  );
  const switchControl = (
    <Switch
      size={compact ? 'sm' : 'default'}
      checked={taskSettings.autoTrustWorktrees}
      disabled={disabled}
      onCheckedChange={taskSettings.updateAutoTrustWorktrees}
      aria-label={label}
    />
  );

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-3">
        {title}
        <div className="flex shrink-0 items-center gap-1.5">
          {overridden ? (
            <ResetToDefaultButton
              defaultLabel="on"
              onReset={taskSettings.resetAutoTrustWorktrees}
              disabled={disabled}
            />
          ) : null}
          {switchControl}
        </div>
      </div>
    );
  }

  return (
    <SettingRow
      title={title}
      description={t('settings.tasks.autoTrustWorktreesDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={overridden}
            defaultLabel="on"
            onReset={taskSettings.resetAutoTrustWorktrees}
            disabled={disabled}
          />
          {switchControl}
        </>
      }
    />
  );
}
