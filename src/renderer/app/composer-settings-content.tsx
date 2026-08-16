import { SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskOutputLanguage } from '@shared/project-settings';
import {
  PROMPT_REWRITE_LANGUAGE_OPTIONS,
  TASK_LANGUAGE_OPTIONS,
  taskLanguageLabel,
} from '@renderer/features/tasks/components/task-language-select';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';

export interface ComposerSettingsContentProps {
  attachImagesAsPaths: boolean;
  promptRewriteEnabled: boolean;
  inputPromptLanguage: TaskOutputLanguage;
  autoGenerateName: boolean;
  namingLanguage: TaskOutputLanguage;
  autoGenerateSummary: boolean;
  summaryLanguage: TaskOutputLanguage;
  onAttachImagesAsPathsChange: (value: boolean) => void;
  onPromptRewriteEnabledChange: (value: boolean) => void;
  onInputPromptLanguageChange: (value: TaskOutputLanguage) => void;
  onAutoGenerateNameChange: (value: boolean) => void;
  onNamingLanguageChange: (value: TaskOutputLanguage) => void;
  onAutoGenerateSummaryChange: (value: boolean) => void;
  onSummaryLanguageChange: (value: TaskOutputLanguage) => void;
  footer?: ReactNode;
}

/**
 * The shared editor for composer/session defaults. Home and the workspace runtime
 * bar intentionally render this same component so a setting has identical
 * behavior regardless of where the user opens it.
 */
export const ComposerSettingsContent = observer(function ComposerSettingsContent({
  attachImagesAsPaths,
  promptRewriteEnabled,
  inputPromptLanguage,
  autoGenerateName,
  namingLanguage,
  autoGenerateSummary,
  summaryLanguage,
  onAttachImagesAsPathsChange,
  onPromptRewriteEnabledChange,
  onInputPromptLanguageChange,
  onAutoGenerateNameChange,
  onNamingLanguageChange,
  onAutoGenerateSummaryChange,
  onSummaryLanguageChange,
  footer,
}: ComposerSettingsContentProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3">
      <ComposerSettingsSection
        icon={<SlidersHorizontal className="size-3.5" />}
        label={t('home.composerEssentialsSectionLabel')}
      >
        <ComposerSettingRow
          label={t('home.attachImagesAsPathsLabel')}
          hint={t('home.attachImagesAsPathsDesc')}
          control={
            <Switch
              size="sm"
              checked={attachImagesAsPaths}
              onCheckedChange={onAttachImagesAsPathsChange}
              aria-label={t('home.attachImagesAsPathsLabel')}
            />
          }
        />
        <ComposerLanguageSelectRow
          label={t('settings.tasks.inputPromptLanguageLabel')}
          value={inputPromptLanguage}
          options={PROMPT_REWRITE_LANGUAGE_OPTIONS}
          enabled={promptRewriteEnabled}
          onEnabledChange={onPromptRewriteEnabledChange}
          onValueChange={onInputPromptLanguageChange}
        />
        <ComposerLanguageSelectRow
          label={t('settings.tasks.sessionTitleLanguageLabel')}
          value={namingLanguage}
          options={TASK_LANGUAGE_OPTIONS}
          enabled={autoGenerateName}
          onEnabledChange={onAutoGenerateNameChange}
          onValueChange={onNamingLanguageChange}
        />
        <ComposerLanguageSelectRow
          label={t('settings.tasks.summaryLanguageLabel')}
          value={summaryLanguage}
          options={TASK_LANGUAGE_OPTIONS}
          enabled={autoGenerateSummary}
          onEnabledChange={onAutoGenerateSummaryChange}
          onValueChange={onSummaryLanguageChange}
        />
      </ComposerSettingsSection>
      {footer}
    </div>
  );
});

function ComposerSettingsSection({
  icon,
  label,
  meta,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="composer-settings-section"
      className="overflow-hidden rounded-lg border border-border/70 bg-background"
    >
      <div
        data-slot="composer-settings-section-header"
        className="flex min-h-9 items-center gap-2 border-b border-border/60 bg-background-1/50 px-3 py-1.5"
      >
        <span className="text-foreground-muted">{icon}</span>
        <h3 className="min-w-0 truncate text-[11px] font-medium text-foreground">{label}</h3>
        {meta}
        <span className="min-w-0 flex-1" />
        {action}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </section>
  );
}

function ComposerSettingRow({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
        {hint ? <InfoTooltip label={label} content={hint} /> : null}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

/**
 * One language-backed capability: a switch for whether it runs at all, plus the
 * target language it uses when it does. Same split as the Sessions settings tab,
 * at composer density — and, as there, the language stays editable while the
 * capability is off, so it can be configured before being switched on.
 */
function ComposerLanguageSelectRow({
  label,
  value,
  options,
  enabled,
  onEnabledChange,
  onValueChange,
}: {
  label: string;
  value: TaskOutputLanguage;
  options: TaskOutputLanguage[];
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  onValueChange: (value: TaskOutputLanguage) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
      <span
        className={cn(
          'min-w-0 truncate text-xs transition-colors',
          enabled ? 'text-foreground' : 'text-foreground-passive'
        )}
      >
        {label}
      </span>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <Select value={value} onValueChange={(next) => onValueChange(next as TaskOutputLanguage)}>
          <SelectTrigger
            size="sm"
            className={cn('h-7 w-28 text-[11px]', !enabled && 'text-foreground-passive')}
          >
            <SelectValue>{taskLanguageLabel(t, value)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {taskLanguageLabel(t, option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          size="sm"
          checked={enabled}
          aria-label={t(
            enabled ? 'home.composerLanguageCallDisable' : 'home.composerLanguageCallEnable',
            { label }
          )}
          title={t(
            enabled ? 'home.composerLanguageCallDisable' : 'home.composerLanguageCallEnable',
            { label }
          )}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </div>
  );
}
