import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeInstructionFile } from '@shared/conversations';
import type { ProjectPromptPrinciples, TaskOutputLanguage } from '@shared/project-settings';
import type { Prompt } from '@shared/prompt-library';
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
import { ContextItem, memoryFileLabel } from '@renderer/features/tasks/components/context-item';
import { PermissionModeSelect } from '@renderer/features/tasks/components/permission-mode-select';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { InfoTooltip } from '@renderer/lib/ui/info-tooltip';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { formatBytes } from '@renderer/utils/formatBytes';
import { cn } from '@renderer/utils/utils';

const TASK_OUTPUT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'prompt', 'zh-CN', 'en'];
const INPUT_PROMPT_ENABLED_LANGUAGE_OPTIONS: TaskOutputLanguage[] = ['app', 'zh-CN', 'en'];
export const DEFAULT_TASK_OUTPUT_LANGUAGE: TaskOutputLanguage = 'skip';
export const DEFAULT_SUMMARY_OUTPUT_LANGUAGE: TaskOutputLanguage = 'app';
export const DEFAULT_INPUT_PROMPT_LANGUAGE: TaskOutputLanguage = 'skip';

export interface ComposerSettingsContentProps {
  runtimeId: RuntimeId | null;
  projectId?: string;
  projectPath?: string;
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
  projectPath,
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
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-xs text-foreground">{t('home.attachImagesAsPathsLabel')}</span>
            <InfoTooltip
              label={t('home.attachImagesAsPathsLabel')}
              content={t('home.attachImagesAsPathsDesc')}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              size="sm"
              checked={attachImagesAsPaths}
              onCheckedChange={onAttachImagesAsPathsChange}
            />
          </div>
        </div>
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
      </div>
      {runtimeId ? (
        <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-2">
          <ComposerSettingsHeader
            label={`${t('home.agentCliConfigLabel')} · ${getRuntime(runtimeId)?.name ?? runtimeId}`}
            hint={t('home.agentCliConfigHint')}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="text-xs text-foreground">{t('home.permissionModeLabel')}</span>
              <InfoTooltip
                label={t('home.permissionModeLabel')}
                content={t('home.permissionModeDesc')}
              />
            </div>
            <PermissionModeSelect
              runtimeId={runtimeId}
              className="shrink-0"
              contentPortaled={false}
              alignContentWithTrigger={false}
            />
          </div>
          <SystemPromptSection
            runtimeId={runtimeId}
            projectId={projectId}
            projectPromptPrinciples={projectPromptPrinciples}
            projectPrincipleItems={projectPrincipleItems}
            promptPrinciples={promptPrinciples}
            disabled={updateLibraryPrompt.isPending || setLibraryPromptGroup.isPending}
            onManage={managePrompts}
            onGlobalPromptChange={(prompt, checked) => {
              if (projectId) {
                saveProjectPromptPrinciples(
                  setGlobalOverride(projectPromptPrinciples, prompt, checked)
                );
                return;
              }
              updateLibraryPrompt.mutate({ id: prompt.id, patch: { injectionEnabled: checked } });
            }}
            onGlobalGroupChange={(groupName, principles, enabled) => {
              if (projectId) {
                saveProjectPromptPrinciples(
                  setGlobalOverrides(projectPromptPrinciples, principles, enabled)
                );
                return;
              }
              setLibraryPromptGroup.mutate({ groupName, enabled });
            }}
            onProjectPromptChange={(id, enabled) => {
              saveProjectPromptPrinciples(
                setProjectItems(
                  projectPromptPrinciples,
                  projectPrincipleItems.map((item) =>
                    item.id === id ? { ...item, enabled } : item
                  )
                )
              );
            }}
          />
          <InstructionFilesSection runtimeId={runtimeId} projectPath={projectPath} />
        </div>
      ) : null}
      {footer}
    </>
  );
});

function SystemPromptSection({
  runtimeId,
  projectId,
  projectPromptPrinciples,
  projectPrincipleItems,
  promptPrinciples,
  disabled,
  onManage,
  onGlobalPromptChange,
  onGlobalGroupChange,
  onProjectPromptChange,
}: {
  runtimeId: RuntimeId;
  projectId?: string;
  projectPromptPrinciples: ProjectPromptPrinciples | undefined;
  projectPrincipleItems: NonNullable<ProjectPromptPrinciples['items']>;
  promptPrinciples: Prompt[];
  disabled: boolean;
  onManage: () => void;
  onGlobalPromptChange: (prompt: Prompt, checked: boolean) => void;
  onGlobalGroupChange: (groupName: string, principles: Prompt[], enabled: boolean) => void;
  onProjectPromptChange: (id: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const runtime = getRuntime(runtimeId);
  if (!runtime?.appendSystemPromptFlag && !runtime?.appendSystemPromptConfigKey) return null;
  const hintKey =
    runtimeId === 'codex'
      ? 'home.systemPromptHintCodex'
      : runtime.appendSystemPromptFlag === '--append-system-prompt'
        ? 'home.systemPromptHintClaude'
        : 'home.systemPromptHint';

  return (
    <div className="flex flex-col gap-1">
      <ComposerSettingsHeader
        label={t('home.systemPromptLabel')}
        hint={t(hintKey)}
        action={
          <button
            type="button"
            className="font-mono text-[10px] uppercase tracking-widest text-foreground-passive transition-colors hover:text-foreground"
            onClick={onManage}
          >
            {t('home.manage')}
          </button>
        }
      />
      <PromptInjectionControls
        prompts={promptPrinciples}
        isPromptEnabled={(prompt) =>
          projectId
            ? effectiveGlobalEnabled(projectPromptPrinciples, prompt)
            : prompt.injectionEnabled
        }
        onPromptEnabledChange={onGlobalPromptChange}
        onGroupEnabledChange={onGlobalGroupChange}
        disabled={disabled}
        empty={<p className="text-xs text-foreground-passive">{t('settings.prompts.empty')}</p>}
      />
      {projectId && projectPrincipleItems.length > 0 ? (
        <>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-foreground-passive">
            {t('home.promptPrinciplesProjectHeading')}
          </div>
          {projectPrincipleItems.map((principle) => (
            <div key={principle.id} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-xs text-foreground">
                  {principle.name || t('home.promptPrincipleUnnamed')}
                </span>
                {principle.text ? (
                  <InfoTooltip
                    label={principle.name || t('home.promptPrincipleUnnamed')}
                    content={<span className="whitespace-pre-wrap">{principle.text}</span>}
                  />
                ) : null}
              </div>
              <Switch
                size="sm"
                checked={principle.enabled}
                onCheckedChange={(checked) => onProjectPromptChange(principle.id, checked)}
                aria-label={t('settings.prompts.toggle')}
              />
            </div>
          ))}
        </>
      ) : null}
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
    <div
      className={cn(
        'flex min-h-8 items-center justify-between gap-3 rounded-md py-1 transition-colors',
        enabled ? 'bg-background-1/50' : 'bg-transparent'
      )}
    >
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
            <SelectTrigger size="sm" className="h-6 w-28 text-[11px]">
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

function ComposerSettingsHeader({
  label,
  hint,
  action,
}: {
  label: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <MicroLabel className="text-[10px]">{label}</MicroLabel>
        {hint ? <InfoTooltip label={label} content={hint} /> : null}
      </div>
      {action}
    </div>
  );
}

function InstructionFilesSection({
  runtimeId,
  projectPath,
}: {
  runtimeId: RuntimeId;
  projectPath?: string;
}) {
  const { t } = useTranslation();
  const runtimeCli = getRuntime(runtimeId)?.cli;
  const supportsInstructionFiles = runtimeCli === 'claude' || runtimeCli === 'codex';
  const hintKey =
    runtimeCli === 'codex'
      ? 'home.instructionFilesHintCodex'
      : runtimeCli === 'claude'
        ? 'home.instructionFilesHintClaude'
        : 'home.instructionFilesHint';
  const { data: files = [] } = useQuery<RuntimeInstructionFile[]>({
    queryKey: ['instructionFiles', runtimeId, projectPath ?? null],
    queryFn: () => rpc.conversations.getRuntimeInstructionFiles({ runtimeId, cwd: projectPath }),
    enabled: supportsInstructionFiles,
    refetchOnWindowFocus: false,
  });

  if (!supportsInstructionFiles) return null;

  return (
    <div className="flex flex-col gap-1">
      <ComposerSettingsHeader label={t('home.instructionFilesLabel')} hint={t(hintKey)} />
      {files.length === 0 ? (
        <p className="text-xs text-foreground-passive">{t('home.noInstructionFiles')}</p>
      ) : (
        files.map((file) => (
          <ContextItem
            key={file.path}
            icon={<FileText className="size-3.5" />}
            label={memoryFileLabel(file, t)}
            meta={formatBytes(file.bytes)}
            text={file.content}
            sourcePath={file.path}
          />
        ))
      )}
    </div>
  );
}
