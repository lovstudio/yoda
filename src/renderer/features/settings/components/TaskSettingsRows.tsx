import { Download, Info } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { useInstallTmux } from '@renderer/lib/components/tmux-install';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { isImeComposing } from '@renderer/utils/ime';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

function InfoTooltip({ label, content }: { label: string; content: React.ReactNode }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={label}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TooltipContent side="top" className="max-w-xs text-xs">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const AutoGenerateTaskNamesRow: React.FC = () => {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('settings.tasks.autoGenerateName')}
      description={t('settings.tasks.autoGenerateNameDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoGenerateName')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoGenerateName}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoGenerateName}
          />
        </>
      }
    />
  );
};

export const InitTaskNameFromSessionRow: React.FC = () => {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('settings.tasks.initTaskNameFromSession')}
      description={t('settings.tasks.initTaskNameFromSessionDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('initTaskNameFromSession')}
            defaultLabel="on"
            onReset={taskSettings.resetInitTaskNameFromSession}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.initTaskNameFromSession}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateInitTaskNameFromSession}
          />
        </>
      }
    />
  );
};

export const BranchNamingRow: React.FC = observer(() => {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={t('settings.tasks.branchNaming')}
      description={t('settings.tasks.branchNamingDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('branchNaming')}
            defaultLabel={t('settings.tasks.branchNamingHash')}
            onReset={taskSettings.resetBranchNaming}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Select
            value={taskSettings.branchNaming}
            onValueChange={(value) => {
              if (value === 'hash' || value === 'ai') taskSettings.updateBranchNaming(value);
            }}
            disabled={taskSettings.loading}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hash">{t('settings.tasks.branchNamingHash')}</SelectItem>
              <SelectItem value="ai">{t('settings.tasks.branchNamingAi')}</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
    />
  );
});

export const AutoTrustWorktreesRow: React.FC = () => {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();

  return (
    <SettingRow
      title={
        <div className="flex items-center gap-1.5">
          {t('settings.tasks.autoTrustWorktrees')}
          <InfoTooltip
            label={t('settings.tasks.autoTrustWorktreesInfoLabel')}
            content={t('settings.tasks.autoTrustWorktreesInfo')}
          />
        </div>
      }
      description={t('settings.tasks.autoTrustWorktreesDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={taskSettings.isFieldOverridden('autoTrustWorktrees')}
            defaultLabel="on"
            onReset={taskSettings.resetAutoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
          />
          <Switch
            checked={taskSettings.autoTrustWorktrees}
            disabled={taskSettings.loading || taskSettings.saving}
            onCheckedChange={taskSettings.updateAutoTrustWorktrees}
          />
        </>
      }
    />
  );
};

export const PreArchiveCommandRow: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: homeDraft,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('homeDraft');

  const command = homeDraft?.preArchiveCommand ?? '';

  return (
    <SettingRow
      title={t('settings.tasks.preArchiveCommand')}
      description={t('settings.tasks.preArchiveCommandDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('preArchiveCommand')}
            defaultLabel="empty"
            onReset={() => resetField('preArchiveCommand')}
            disabled={loading || saving}
          />
          <Input
            key={command}
            type="text"
            defaultValue={command}
            disabled={loading || saving}
            placeholder={t('settings.tasks.preArchiveCommandPlaceholder')}
            onBlur={(e) => {
              const next = e.target.value;
              if (next !== command) update({ preArchiveCommand: next });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                e.currentTarget.blur();
              }
            }}
            className="w-72"
          />
        </>
      }
    />
  );
};

export const EnableTmuxRow: React.FC = observer(() => {
  const { t } = useTranslation();
  const installTmux = useInstallTmux();
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxByDefault = projects?.tmuxByDefault ?? true;
  const tmuxState = appState.dependencies.allStatuses['tmux'];
  const tmuxMissing = tmuxState?.status === 'missing';
  const installingTmux = appState.dependencies.isInstalling('tmux');
  const handleInstallTmux = useCallback(() => {
    void installTmux();
  }, [installTmux]);

  return (
    <SettingRow
      title={t('settings.tasks.enableTmux')}
      description={
        <span className="flex flex-col gap-1">
          <span>{t('settings.tasks.enableTmuxDescription')}</span>
          {tmuxMissing && <span className="text-amber-500">{t('settings.tasks.tmuxMissing')}</span>}
        </span>
      }
      control={
        <>
          {tmuxMissing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={installingTmux}
              onClick={handleInstallTmux}
            >
              <Download className="h-3.5 w-3.5" />
              {installingTmux
                ? t('settings.tasks.installingTmux')
                : t('settings.tasks.installTmux')}
            </Button>
          )}
          <ResetToDefaultButton
            visible={isFieldOverridden('tmuxByDefault')}
            defaultLabel="on"
            onReset={() => resetField('tmuxByDefault')}
            disabled={loading || saving}
          />
          <Switch
            checked={tmuxByDefault}
            disabled={loading || saving}
            onCheckedChange={(checked) => update({ tmuxByDefault: checked })}
          />
        </>
      }
    />
  );
});
