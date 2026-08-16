import React from 'react';
import { useTranslation } from 'react-i18next';
import { NamingConfigFields } from '@renderer/features/tasks/components/naming-config-fields';
import { SummaryConfigFields } from '@renderer/features/tasks/components/summary-config-fields';
import { SettingDisclosure } from './SettingDisclosure';
import {
  AutoGenerateSummaryControl,
  AutoGenerateTaskNamesControl,
  InputPromptLanguageRow,
} from './TaskSettingsRows';

/**
 * What an agent does for a session while it runs: rewrite the prompt, name the
 * session, summarize it. Each capability reads as a single row; the fields that
 * tune it stay folded away, so the chapter is a short list instead of three
 * full-height forms.
 */
const SessionAiSettingsCard: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col divide-y divide-border/70">
      <div className="pb-4">
        <InputPromptLanguageRow />
      </div>
      <div className="py-4">
        <SettingDisclosure
          title={t('settings.tasks.autoGenerateName')}
          description={t('settings.tasks.autoGenerateNameDescription')}
          control={<AutoGenerateTaskNamesControl />}
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-foreground-passive">
              {t('settings.tasks.namingConfigDescription')}
            </p>
            <NamingConfigFields />
          </div>
        </SettingDisclosure>
      </div>
      <div className="pt-4">
        <SettingDisclosure
          title={t('settings.tasks.autoGenerateSummary')}
          description={t('settings.tasks.autoGenerateSummaryDescription')}
          control={<AutoGenerateSummaryControl />}
        >
          <div className="flex flex-col gap-2">
            <p className="text-xs text-foreground-passive">
              {t('settings.tasks.summaryConfigDescription')}
            </p>
            <SummaryConfigFields />
          </div>
        </SettingDisclosure>
      </div>
    </div>
  );
};

export default SessionAiSettingsCard;
