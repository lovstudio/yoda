import { ArrowRight, Bot, Folder, LibraryBig, SlidersHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectPromptPrinciples, TaskOutputLanguage } from '@shared/project-settings';
import { getRuntime, type RuntimeId } from '@shared/runtime-registry';
import {
  effectiveGlobalEnabled,
  setGlobalOverride,
  setGlobalOverrides,
  setProjectItems,
} from '@renderer/features/projects/project-prompt-principles';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { PromptInjectionControls } from '@renderer/features/prompt-library/prompt-injection-controls';
import {
  usePrompts,
  useSetPromptGroupInjectionEnabled,
  useUpdatePrompt,
} from '@renderer/features/prompt-library/use-prompts';
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
  const updateLibraryPrompt = useUpdatePrompt();
  const setLibraryPromptGroup = useSetPromptGroupInjectionEnabled();
  const promptPrinciples = (promptLibraryItems ?? [])
    .slice()
    .sort((left, right) => left.injectionOrder - right.injectionOrder);
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
  const saveProjectPromptPrinciples = (next: ProjectPromptPrinciples | undefined) => {
    if (!projectSettingsStore || !projectSettings) return;
    void projectSettingsStore.save({ ...projectSettings, promptPrinciples: next });
  };
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
          action={
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] tabular-nums text-foreground-passive">
                {t('home.enabledPromptCount', { count: enabledPromptCount })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="-mr-1"
                onClick={managePrompts}
              >
                {t('home.openPromptLibrary')}
                <ArrowRight className="size-3" />
              </Button>
            </div>
          }
        >
          {promptPrinciples.length > 0 || (projectId && projectPrincipleItems.length > 0) ? (
            <div className="max-h-48 overflow-y-auto overscroll-contain">
              {promptPrinciples.length > 0 ? (
                <PromptInjectionControls
                  variant="compact"
                  prompts={promptPrinciples}
                  isPromptEnabled={(prompt) =>
                    projectId
                      ? effectiveGlobalEnabled(projectPromptPrinciples, prompt)
                      : prompt.injectionEnabled
                  }
                  onPromptEnabledChange={(prompt, checked) => {
                    if (projectId) {
                      saveProjectPromptPrinciples(
                        setGlobalOverride(projectPromptPrinciples, prompt, checked)
                      );
                      return;
                    }
                    updateLibraryPrompt.mutate({
                      id: prompt.id,
                      patch: { injectionEnabled: checked },
                    });
                  }}
                  onGroupEnabledChange={(groupName, prompts, enabled) => {
                    if (projectId) {
                      saveProjectPromptPrinciples(
                        setGlobalOverrides(projectPromptPrinciples, prompts, enabled)
                      );
                      return;
                    }
                    setLibraryPromptGroup.mutate({
                      groupName,
                      enabled,
                    });
                  }}
                  disabled={updateLibraryPrompt.isPending || setLibraryPromptGroup.isPending}
                />
              ) : null}
              {projectId && projectPrincipleItems.length > 0 ? (
                <CompactProjectPromptControls
                  items={projectPrincipleItems}
                  separated={promptPrinciples.length > 0}
                  onEnabledChange={(id, enabled) =>
                    saveProjectPromptPrinciples(
                      setProjectItems(
                        projectPromptPrinciples,
                        projectPrincipleItems.map((item) =>
                          item.id === id ? { ...item, enabled } : item
                        )
                      )
                    )
                  }
                />
              ) : null}
            </div>
          ) : (
            <p className="px-3 py-2.5 text-[11px] text-foreground-passive">
              {t('settings.prompts.empty')}
            </p>
          )}
        </ComposerSettingsSection>
      ) : null}
      {footer}
    </div>
  );
});

function ComposerSettingsSection({
  icon,
  label,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
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
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">{label}</h3>
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

function CompactProjectPromptControls({
  items,
  separated,
  onEnabledChange,
}: {
  items: NonNullable<ProjectPromptPrinciples['items']>;
  separated: boolean;
  onEnabledChange: (id: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const enabledCount = items.filter((item) => item.enabled).length;

  return (
    <section
      data-slot="project-prompt-injection-group"
      className={cn(separated && 'border-t border-border/50')}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-background-1 px-3 py-1.5">
        <Folder className="size-3 shrink-0 text-foreground-muted" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {t('home.promptPrinciplesProjectHeading')}
        </span>
        <span className="text-[11px] tabular-nums text-foreground-passive">
          {t('promptLibrary.groups.enabledCount', {
            enabled: enabledCount,
            count: items.length,
          })}
        </span>
      </div>
      <div className="divide-y divide-border/50">
        {items.map((item) => {
          const name = item.name || t('home.promptPrincipleUnnamed');
          return (
            <div
              key={item.id}
              data-slot="project-prompt-injection-row"
              className="flex min-h-8 items-center justify-between gap-3 px-3 py-1.5"
            >
              <span className="min-w-0 truncate text-[11px] text-foreground">{name}</span>
              <Switch
                size="sm"
                checked={item.enabled}
                onCheckedChange={(enabled) => onEnabledChange(item.id, enabled)}
                aria-label={t('promptLibrary.injection.toggle', { name })}
              />
            </div>
          );
        })}
      </div>
    </section>
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
