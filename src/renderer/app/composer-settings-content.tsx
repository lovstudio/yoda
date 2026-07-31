import { ArrowRight, Bot, LibraryBig, SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskOutputLanguage } from '@shared/project-settings';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import { effectiveGlobalEnabled } from '@renderer/features/projects/project-prompt-principles';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { usePrompts } from '@renderer/features/prompt-library/use-prompts';
import { AutoTrustWorktreesControl } from '@renderer/features/tasks/components/auto-trust-worktrees-control';
import { PermissionModeSelect } from '@renderer/features/tasks/components/permission-mode-select';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
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

const TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'prompt', 'zh-CN', 'en'];
const INPUT_PROMPT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'zh-CN', 'en'];
export const DEFAULT_TASK_OUTPUT_LANGUAGE: TaskOutputLanguage = 'skip';
export const DEFAULT_SUMMARY_OUTPUT_LANGUAGE: TaskOutputLanguage = 'app';
export const DEFAULT_INPUT_PROMPT_LANGUAGE: TaskOutputLanguage = 'skip';

export interface ComposerSettingsContentProps {
  runtimeId: RuntimeId | null;
  projectId?: string;
  attachImagesAsPaths: boolean;
  inputPromptLanguage: TaskOutputLanguage;
  namingLanguage: TaskOutputLanguage;
  summaryLanguage: TaskOutputLanguage;
  onAttachImagesAsPathsChange: (value: boolean) => void;
  onInputPromptLanguageChange: (value: TaskOutputLanguage) => void;
  onNamingLanguageChange: (value: TaskOutputLanguage) => void;
  onSummaryLanguageChange: (value: TaskOutputLanguage) => void;
  onManagePrompts?: () => void;
  footer?: ReactNode;
}

/**
 * The shared editor for composer/session defaults. Home and the workspace runtime
 * bar intentionally render this same component so a setting has identical
 * behavior regardless of where the user opens it.
 */
export const ComposerSettingsContent = observer(function ComposerSettingsContent({
  runtimeId,
  projectId,
  attachImagesAsPaths,
  inputPromptLanguage,
  namingLanguage,
  summaryLanguage,
  onAttachImagesAsPathsChange,
  onInputPromptLanguageChange,
  onNamingLanguageChange,
  onSummaryLanguageChange,
  onManagePrompts,
  footer,
}: ComposerSettingsContentProps) {
  const { t } = useTranslation();
  const { data: promptLibraryItems } = usePrompts();
  const promptPrinciples = promptLibraryItems ?? [];
  const projectSettingsStore = projectId ? getProjectSettingsStore(projectId) : undefined;
  const projectSettings = projectSettingsStore?.settings ?? null;
  const projectPromptPrinciples = projectSettings?.promptPrinciples;
  const projectPrincipleItems = projectPromptPrinciples?.items ?? [];
  const runtime = runtimeId ? getRuntime(runtimeId) : undefined;
  const supportsPromptConfiguration = Boolean(
    runtime?.appendSystemPromptFlag ||
      runtime?.appendSystemPromptConfigKey ||
      runtime?.cli === 'claude' ||
      runtime?.cli === 'codex'
  );
  const enabledPromptCount =
    promptPrinciples.filter((prompt) =>
      projectId ? effectiveGlobalEnabled(projectPromptPrinciples, prompt) : prompt.injectionEnabled
    ).length + projectPrincipleItems.filter((principle) => principle.enabled).length;
  const managePrompts = () => {
    if (onManagePrompts) {
      onManagePrompts();
      return;
    }
    appState.navigation.navigate('library', { section: 'prompts' });
  };

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
          options={INPUT_PROMPT_ENABLED_LANGUAGE_OPTIONS}
          disabledValues={['skip', 'prompt']}
          onValueChange={onInputPromptLanguageChange}
        />
        <ComposerLanguageSelectRow
          label={t('settings.tasks.sessionTitleLanguageLabel')}
          value={namingLanguage}
          options={TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS}
          onValueChange={onNamingLanguageChange}
        />
        <ComposerLanguageSelectRow
          label={t('settings.tasks.summaryLanguageLabel')}
          value={summaryLanguage}
          options={TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS}
          onValueChange={onSummaryLanguageChange}
        />
      </ComposerSettingsSection>
      {runtimeId ? (
        <ComposerSettingsSection
          icon={<Bot className="size-3.5" />}
          label={`${t('home.agentCliConfigLabel')} · ${runtime?.name ?? runtimeId}`}
        >
          <ComposerSettingRow
            label={t('home.permissionModeLabel')}
            hint={t('home.permissionModeDesc')}
            control={
              <PermissionModeSelect
                runtimeId={runtimeId}
                className="shrink-0"
                contentPortaled={false}
                alignContentWithTrigger={false}
              />
            }
          />
          {runtimeId === 'codex' || runtimeId === 'claude' ? (
            <div className="px-3 py-2">
              <AutoTrustWorktreesControl compact />
            </div>
          ) : null}
        </ComposerSettingsSection>
      ) : null}
      {runtimeId && supportsPromptConfiguration ? (
        <ComposerSettingsSection
          icon={<LibraryBig className="size-3.5" />}
          label={t('home.promptConfigurationLabel')}
        >
          <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full bg-background-2 px-2 py-1 text-[11px] tabular-nums text-foreground-muted">
                {t('home.enabledPromptCount', { count: enabledPromptCount })}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={managePrompts}>
                {t('home.openPromptLibrary')}
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-foreground-passive">
              {t('home.promptConfigurationDescription')}
            </p>
          </div>
        </ComposerSettingsSection>
      ) : null}
      {footer}
    </div>
  );
});

function ComposerSettingsSection({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex items-center gap-2 border-b border-border/60 bg-background-1/50 px-3 py-2">
        <span className="text-foreground-muted">{icon}</span>
        <h3 className="min-w-0 truncate text-[11px] font-medium text-foreground">{label}</h3>
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

function taskOutputLanguageLabel(t: ReturnType<typeof useTranslation>['t'], value: string): string {
  switch (value) {
    case 'skip':
      return t('settings.tasks.namingLanguageSkip');
    case 'app':
      return t('settings.tasks.namingLanguageApp');
    case 'prompt':
      return t('settings.tasks.namingLanguagePrompt');
    case 'zh-CN':
      return t('settings.tasks.namingLanguageZh');
    case 'en':
      return t('settings.tasks.namingLanguageEn');
    default:
      return value;
  }
}

function ComposerLanguageSelectRow({
  label,
  value,
  options,
  disabledValues = ['skip'],
  onValueChange,
}: {
  label: string;
  value: TaskOutputLanguage;
  options: TaskOutputLanguage[];
  disabledValues?: TaskOutputLanguage[];
  onValueChange: (value: TaskOutputLanguage) => void;
}) {
  const { t } = useTranslation();
  const enabled = !disabledValues.includes(value);
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
        {enabled ? (
          <Select value={value} onValueChange={(next) => onValueChange(next as TaskOutputLanguage)}>
            <SelectTrigger size="sm" className="h-7 w-28 text-[11px]">
              <SelectValue>{taskOutputLanguageLabel(t, value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {taskOutputLanguageLabel(t, option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
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
          onCheckedChange={(next) => onValueChange(next ? 'app' : 'skip')}
        />
      </div>
    </div>
  );
}
