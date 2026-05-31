import { observer } from 'mobx-react-lite';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getProvider, type AgentProviderId } from '@shared/agent-provider-registry';
import { AgentKeyValueRow } from './AgentKeyValueRow';
import { AgentSection } from './AgentSection';

export const AgentTabMaaS: React.FC<{ agentId: AgentProviderId }> = observer(function AgentTabMaaS({
  agentId,
}) {
  const { t } = useTranslation();
  const provider = getProvider(agentId);
  if (!provider) return null;

  const flags: Array<{ key: string; value?: string }> = [
    { key: t('agents.maas.cli'), value: provider.cli },
    { key: t('agents.maas.autoApprove'), value: provider.autoApproveFlag },
    { key: t('agents.maas.initialPrompt'), value: provider.initialPromptFlag },
    { key: t('agents.maas.resume'), value: provider.resumeFlag },
    { key: t('agents.maas.sessionId'), value: provider.sessionIdFlag },
    { key: t('agents.maas.newConversation'), value: provider.newConversationFlag },
    { key: t('agents.maas.commandPrefix'), value: provider.commandPrefix },
    { key: t('agents.maas.planActivate'), value: provider.planActivateCommand },
    { key: t('agents.maas.autoStart'), value: provider.autoStartCommand },
    { key: t('agents.maas.defaultArgs'), value: provider.defaultArgs?.join(' ') },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <AgentSection title={t('agents.maas.title')} description={t('agents.maas.description')}>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('agents.maas.placeholder', { name: provider.name })}
        </p>
      </AgentSection>

      <AgentSection
        title={t('agents.maas.cliFlags')}
        description={t('agents.maas.cliFlagsDescription')}
      >
        <div className="divide-y divide-border rounded-md border border-border">
          {flags.map((flag) => (
            <AgentKeyValueRow key={flag.key} label={flag.key} value={flag.value} />
          ))}
        </div>
      </AgentSection>
    </div>
  );
});
