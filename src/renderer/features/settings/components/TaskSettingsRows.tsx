import { Download, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { useInstallTmux } from '@renderer/lib/components/tmux-install';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Separator } from '@renderer/lib/ui/separator';
import { Switch } from '@renderer/lib/ui/switch';
import { isImeComposing } from '@renderer/utils/ime';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

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

/**
 * Sessions tab: the per-session opt-in toggle only. Detection/version/path and
 * install live in {@link TmuxSettingsRows} under the Terminal tab.
 */
export const EnableTmuxRow: React.FC = observer(() => {
  const { t } = useTranslation();
  const {
    value: projects,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('project');

  const tmuxByDefault = projects?.tmuxByDefault ?? true;

  return (
    <SettingRow
      title={t('settings.tasks.enableTmux')}
      description={t('settings.tasks.enableTmuxDescription')}
      control={
        <>
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

/**
 * Re-probes all dependencies (cheap) so a freshly-installed or PATH-late tmux is
 * picked up. Lives in the tmux tab's Status row; mirrors {@link
 * CliAgentsRescanButton}.
 */
export const TmuxRecheckButton: React.FC = observer(() => {
  const { t } = useTranslation();
  const [rechecking, setRechecking] = useState(false);
  const handleRecheck = useCallback(() => {
    setRechecking(true);
    void appState.dependencies.probeAll().finally(() => setRechecking(false));
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="gap-1.5"
      disabled={rechecking}
      onClick={handleRecheck}
    >
      <RefreshCw className={cn('h-3.5 w-3.5', rechecking && 'animate-spin')} />
      {rechecking ? t('settings.tasks.recheckingTmux') : t('settings.tasks.recheckTmux')}
    </Button>
  );
});

/**
 * tmux rendered as a chapter inside the Terminal tab: a divider + a prominent
 * heading (one step below the page title) and description, then a row-based body
 * (detection status, binary path) so future tmux options — socket name, mouse
 * mode, kill-on-archive, … — slot in as additional {@link SettingRow}s without
 * reworking the layout. Re-check is the chapter's heading action. The enable
 * toggle lives in {@link EnableTmuxRow} under the Sessions tab.
 */
export const TmuxSettingsChapter: React.FC = observer(() => {
  const { t } = useTranslation();
  const installTmux = useInstallTmux();

  const tmuxState = appState.dependencies.allStatuses['tmux'];
  const tmuxStatus = tmuxState?.status;
  const tmuxMissing = tmuxStatus === 'missing';
  const tmuxAvailable = tmuxStatus === 'available';
  const tmuxErrored = tmuxStatus === 'error';
  const installingTmux = appState.dependencies.isInstalling('tmux');
  const handleInstallTmux = useCallback(() => {
    void installTmux();
  }, [installTmux]);

  // Calm dependency-status language (matches RuntimeAccordion): a status dot +
  // muted tabular label, never multi-colored prose.
  const statusLabel = tmuxAvailable
    ? tmuxState?.version
      ? `v${tmuxState.version}`
      : t('settings.agentsTab.detected')
    : tmuxErrored
      ? t('settings.tasks.tmuxStatusError')
      : t('settings.agentsTab.notDetected');

  return (
    <div className="flex flex-col gap-4">
      <Separator />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-lg text-foreground">{t('settings.terminal.tmux')}</h3>
          <p className="text-sm text-foreground-muted">
            {t('settings.tasks.enableTmuxDescription')}
          </p>
        </div>
        <TmuxRecheckButton />
      </div>
      <div className="flex flex-col gap-3">
        <SettingRow
          title={t('settings.tasks.tmuxStatusRow')}
          description={
            tmuxErrored && tmuxState?.error ? (
              <span className="text-destructive">
                {t('settings.tasks.tmuxError', { error: tmuxState.error })}
              </span>
            ) : undefined
          }
          control={
            <>
              <span className="flex items-center gap-2 pr-1">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    tmuxAvailable
                      ? 'bg-emerald-500'
                      : tmuxErrored
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground/40'
                  )}
                  aria-hidden="true"
                />
                <span className="text-xs tabular-nums text-foreground-passive">{statusLabel}</span>
              </span>
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
            </>
          }
        />
        {tmuxAvailable && tmuxState?.path && (
          <SettingRow
            title={t('settings.tasks.tmuxPathRow')}
            control={
              <span
                className="max-w-[360px] truncate font-mono text-xs text-foreground-passive"
                title={tmuxState.path}
              >
                {tmuxState.path}
              </span>
            }
          />
        )}
      </div>
    </div>
  );
});
