import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LLM_PROFILE_RUNTIME_ID } from '@shared/global-llm';
import { getRuntime, isValidRuntimeId, RUNTIMES, type RuntimeId } from '@shared/runtime-registry';
import { AgentTabModels } from '@renderer/features/agents/components/AgentTabModels';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { SettingRow } from './SettingRow';

export default function ModelsSettingsCard() {
  const { t } = useTranslation();
  const providers = useMemo(() => RUNTIMES.filter((runtime) => runtime.detectable !== false), []);
  const [providerId, setProviderId] = useState<RuntimeId>(DEFAULT_LLM_PROFILE_RUNTIME_ID);
  const selectedProvider = getRuntime(providerId);

  return (
    <div className="@container flex min-w-0 flex-col gap-5" data-testid="models-settings-card">
      <SettingRow
        title={t('settings.models.provider')}
        description={t('settings.models.providerDescription')}
        control={
          <Select
            value={providerId}
            onValueChange={(value) => {
              if (value && isValidRuntimeId(value)) setProviderId(value);
            }}
          >
            <SelectTrigger
              className="w-52 max-w-[55cqw]"
              aria-label={t('settings.models.provider')}
            >
              <SelectValue>
                {() => selectedProvider?.name ?? t('settings.models.providerUnknown')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="max-h-80">
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="border-t border-border pt-5">
        <AgentTabModels key={providerId} agentId={providerId} embedded />
      </div>
    </div>
  );
}
