import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import { AgentSelector } from '@renderer/lib/components/agent-selector/agent-selector';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';

export type InitialConversationState = {
  provider: AgentProviderId | null;
  setProvider: (provider: AgentProviderId | null) => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
};

export function useInitialConversationState(connectionId?: string): InitialConversationState {
  const { providerId, setProviderOverride } = useEffectiveProvider(connectionId);
  const [prompt, setPrompt] = useState('');
  return { provider: providerId, setProvider: setProviderOverride, prompt, setPrompt };
}

interface InitialConversationFieldProps {
  state: InitialConversationState;
  connectionId?: string;
}

export function InitialConversationField({ state, connectionId }: InitialConversationFieldProps) {
  const { t } = useTranslation();
  const autoApproveDefaults = useAgentAutoApproveDefaults();

  return (
    <>
      <Field>
        <FieldLabel>{t('tasks.create.initialConversation')}</FieldLabel>
        <div className="flex flex-col border border-border rounded-md">
          <AgentSelector
            value={state.provider}
            onChange={(provider) => state.setProvider(provider)}
            connectionId={connectionId}
            className="rounded-none border-0 border-b"
          />
          <Textarea
            placeholder={t('tasks.create.initialPromptPlaceholder')}
            value={state.prompt}
            onChange={(e) => state.setPrompt(e.target.value)}
            className="min-h-24 resize-none border-0 rounded-none focus-visible:ring-0 focus-visible:border-0"
          />
        </div>
      </Field>
      <Field>
        <div className="flex items-center gap-2">
          <Switch
            checked={state.provider ? autoApproveDefaults.getDefault(state.provider) : false}
            disabled={!state.provider || autoApproveDefaults.loading || autoApproveDefaults.saving}
            onCheckedChange={(checked) => {
              if (state.provider) autoApproveDefaults.setDefault(state.provider, checked);
            }}
          />
          <FieldLabel>{t('tasks.create.dangerouslySkipPermissions')}</FieldLabel>
        </div>
      </Field>
    </>
  );
}
