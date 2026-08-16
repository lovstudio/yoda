import {
  AGENT_REPLY_DISPLAY_LEVELS,
  isAgentReplyDisplayLevel,
  type AgentReplyDisplayLevel,
} from '@lovstudio/yoda-protocol/agent-reply-display';
import { useTranslation } from 'react-i18next';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

function labelKey(level: AgentReplyDisplayLevel): string {
  return `tasks.sessionPanel.agentReplyDisplay.${level}.label`;
}

export default function SessionShareDisplayLevelSettingsRow() {
  const { t } = useTranslation();
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');
  const level = interfaceSettings?.sessionShareDisplayLevel ?? 'concise';
  const disabled = isLoading || isSaving;

  return (
    <SettingRow
      title={t('settings.interfaceTab.sessionShareDisplayLevel')}
      description={t('settings.interfaceTab.sessionShareDisplayLevelDescription')}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('sessionShareDisplayLevel')}
            defaultLabel={t(labelKey('concise'))}
            onReset={() => resetField('sessionShareDisplayLevel')}
            disabled={disabled}
          />
          <Select
            value={level}
            onValueChange={(value) => {
              if (isAgentReplyDisplayLevel(value)) {
                update({ sessionShareDisplayLevel: value });
              }
            }}
            disabled={disabled}
          >
            <SelectTrigger
              aria-label={t('settings.interfaceTab.sessionShareDisplayLevel')}
              className="h-8 w-36"
            >
              <SelectValue>
                {(value: string | null) =>
                  t(labelKey(isAgentReplyDisplayLevel(value) ? value : 'concise'))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AGENT_REPLY_DISPLAY_LEVELS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(labelKey(option))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    />
  );
}
