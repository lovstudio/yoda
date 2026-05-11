import React from 'react';
import { useTranslation } from 'react-i18next';
import { isValidProviderId, type AgentProviderId } from '@shared/agent-provider-registry';
import type { AppSettings } from '@shared/app-settings';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { SettingRow } from './SettingRow';

const DEFAULT_AGENT: AgentProviderId = 'claude';

const DefaultAgentSettingsCard: React.FC = () => {
  const { t } = useTranslation();
  const {
    value: defaultAgentValue,
    update,
    isLoading: loading,
    isSaving: saving,
  } = useAppSettingsKey('defaultAgent');

  const defaultAgent: AgentProviderId = isValidProviderId(defaultAgentValue)
    ? (defaultAgentValue as AgentProviderId)
    : DEFAULT_AGENT;

  const handleChange = (agent: AgentProviderId) => {
    update(agent as AppSettings['defaultAgent']);
  };

  return (
    <SettingRow
      title={t('settings.defaultAgent.title')}
      description={t('settings.defaultAgent.description')}
      control={
        <div className="w-[183px] shrink-0">
          <AgentSelector
            value={defaultAgent}
            onChange={handleChange}
            disabled={loading || saving}
            className="w-full"
          />
        </div>
      }
    />
  );
};

export default DefaultAgentSettingsCard;
