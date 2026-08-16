import { Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  resolveOutputLanguage,
  resolveOutputLanguageOverride,
  resolvePromptRewriteEnabled,
  resolvePromptRewriteLanguage,
  resolvePromptRewriteLanguageOverride,
  type ComposerDefaults,
  type TaskOutputLanguage,
} from '@shared/project-settings';
import { dualField, withComposerDefault } from '@renderer/app/composer-project-overrides';
import { ComposerSettingsContent } from '@renderer/app/composer-settings-content';
import {
  WORKSPACE_BAR_CARD_CLASS,
  WorkspaceBarCardHeader,
  WorkspaceBarCardSection,
} from '@renderer/app/workspace-bar-card';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';
import { RUNTIME_BAR_ACTION_CLASS, RUNTIME_BAR_ACTION_LABEL_CLASS } from '../bar-chrome';
import { useRuntimeBarSession } from '../session-context';

/**
 * Composer defaults, at the bar's leading edge. Every field is a project
 * override layered over a global default, so the same popover reads correctly
 * with or without a project in view.
 */
export const RuntimeBarConfigItem = observer(function RuntimeBarConfigItem() {
  const { t } = useTranslation();
  const [isConfigPopoverOpen, setIsConfigPopoverOpen] = useState(false);
  const { activeProjectId } = useRuntimeBarSession();
  const { value: homeDraft, update: updateHomeDraft } = useAppSettingsKey('homeDraft');
  const { value: taskSettings, update: updateTaskSettings } = useAppSettingsKey('tasks');
  const projectSettingsStore = activeProjectId
    ? getProjectSettingsStore(activeProjectId)
    : undefined;
  const projectSettings = projectSettingsStore?.settings ?? null;
  const composerDefaults = projectSettings?.composerDefaults;
  const setComposerDefault = useCallback(
    <K extends keyof ComposerDefaults>(field: K, value: ComposerDefaults[K] | undefined) => {
      if (!projectSettingsStore || !projectSettings) return;
      void projectSettingsStore.save({
        ...projectSettings,
        composerDefaults: withComposerDefault(projectSettings.composerDefaults, field, value),
      });
    },
    [projectSettingsStore, projectSettings]
  );
  const attachImagesField = dualField<boolean>({
    override: composerDefaults?.attachImagesAsPaths,
    globalValue: homeDraft?.attachImagesAsPaths ?? false,
    setGlobal: (value) => updateHomeDraft({ attachImagesAsPaths: value }),
    setOverride: (value) => setComposerDefault('attachImagesAsPaths', value),
    hasProject: Boolean(activeProjectId),
  });
  // A capability's switch and its configuration are separate fields, so a
  // project (or the user) can configure one that is currently switched off.
  const globalPromptRewriteEnabled = resolvePromptRewriteEnabled(
    taskSettings?.promptRewriteEnabled,
    taskSettings?.inputPromptLanguage
  );
  const promptRewriteEnabledField = dualField<boolean>({
    override: composerDefaults?.promptRewriteEnabled,
    globalValue: globalPromptRewriteEnabled,
    setGlobal: (value) => updateTaskSettings({ promptRewriteEnabled: value }),
    setOverride: (value) => setComposerDefault('promptRewriteEnabled', value),
    hasProject: Boolean(activeProjectId),
  });
  const inputPromptLanguageField = dualField<TaskOutputLanguage>({
    override: resolvePromptRewriteLanguageOverride(composerDefaults?.inputPromptLanguage),
    globalValue: resolvePromptRewriteLanguage(taskSettings?.inputPromptLanguage),
    // Writing the language pins the switch too — see home-view.
    setGlobal: (value) =>
      updateTaskSettings({
        inputPromptLanguage: value,
        promptRewriteEnabled: globalPromptRewriteEnabled,
      }),
    setOverride: (value) => setComposerDefault('inputPromptLanguage', value),
    hasProject: Boolean(activeProjectId),
  });
  const autoGenerateNameField = dualField<boolean>({
    override: composerDefaults?.autoGenerateName,
    globalValue: taskSettings?.autoGenerateName ?? false,
    setGlobal: (value) => updateTaskSettings({ autoGenerateName: value }),
    setOverride: (value) => setComposerDefault('autoGenerateName', value),
    hasProject: Boolean(activeProjectId),
  });
  const namingLanguageField = dualField<TaskOutputLanguage>({
    override: resolveOutputLanguageOverride(composerDefaults?.namingLanguage),
    globalValue: resolveOutputLanguage(taskSettings?.namingLanguage),
    setGlobal: (value) => updateTaskSettings({ namingLanguage: value }),
    setOverride: (value) => setComposerDefault('namingLanguage', value),
    hasProject: Boolean(activeProjectId),
  });
  const autoGenerateSummaryField = dualField<boolean>({
    override: composerDefaults?.autoGenerateSummary,
    globalValue: taskSettings?.autoGenerateSummary ?? true,
    setGlobal: (value) => updateTaskSettings({ autoGenerateSummary: value }),
    setOverride: (value) => setComposerDefault('autoGenerateSummary', value),
    hasProject: Boolean(activeProjectId),
  });
  const summaryLanguageField = dualField<TaskOutputLanguage>({
    override: resolveOutputLanguageOverride(composerDefaults?.summaryLanguage),
    globalValue: resolveOutputLanguage(taskSettings?.summaryLanguage),
    setGlobal: (value) => updateTaskSettings({ summaryLanguage: value }),
    setOverride: (value) => setComposerDefault('summaryLanguage', value),
    hasProject: Boolean(activeProjectId),
  });

  return (
    <Popover open={isConfigPopoverOpen} onOpenChange={setIsConfigPopoverOpen}>
      <PopoverTrigger
        aria-label={t('workspaceRuntime.config.title')}
        className={cn(
          RUNTIME_BAR_ACTION_CLASS,
          isConfigPopoverOpen && 'bg-background-2 text-foreground'
        )}
        title={t('workspaceRuntime.config.title')}
      >
        <Settings2 className="size-3.5" />
        <span className={RUNTIME_BAR_ACTION_LABEL_CLASS}>{t('workspaceRuntime.config.title')}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className={cn(
          WORKSPACE_BAR_CARD_CLASS,
          'max-h-[min(32rem,calc(100vh-3rem))] w-96 overflow-y-auto'
        )}
      >
        <WorkspaceBarCardHeader
          icon={Settings2}
          title={t('workspaceRuntime.config.title')}
          description={t('workspaceRuntime.config.description')}
        />
        <WorkspaceBarCardSection>
          <ComposerSettingsContent
            attachImagesAsPaths={attachImagesField.value}
            promptRewriteEnabled={promptRewriteEnabledField.value}
            inputPromptLanguage={inputPromptLanguageField.value}
            autoGenerateName={autoGenerateNameField.value}
            namingLanguage={namingLanguageField.value}
            autoGenerateSummary={autoGenerateSummaryField.value}
            summaryLanguage={summaryLanguageField.value}
            onAttachImagesAsPathsChange={attachImagesField.setValue}
            onPromptRewriteEnabledChange={promptRewriteEnabledField.setValue}
            onInputPromptLanguageChange={inputPromptLanguageField.setValue}
            onAutoGenerateNameChange={autoGenerateNameField.setValue}
            onNamingLanguageChange={namingLanguageField.setValue}
            onAutoGenerateSummaryChange={autoGenerateSummaryField.setValue}
            onSummaryLanguageChange={summaryLanguageField.setValue}
          />
        </WorkspaceBarCardSection>
      </PopoverContent>
    </Popover>
  );
});
