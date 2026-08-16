import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { SUMMARY_CONTEXT_SOURCE_IDS } from '@shared/session-summary';
import { UtilityAgentPicker } from '@renderer/features/tasks/components/utility-agent-picker';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';

/**
 * Picker that binds an Agent to session-summary generation (`summaryAgentId`).
 * Mirrors the naming Agent picker, but summary runs entirely on the chosen
 * Agent's own provider/model — so it stays usable even when the session's own
 * runtime is dead. Empty selection falls back to the built-in summary Agent.
 */
export const SummaryConfigFields = observer(function SummaryConfigFields({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const disabled = taskSettings.loading || taskSettings.saving;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <UtilityAgentPicker
        label={t('settings.tasks.summaryAgentLabel')}
        hint={t('settings.tasks.summaryAgentHint')}
        agentId={taskSettings.summaryAgentId}
        onAgentIdChange={taskSettings.updateSummaryAgentId}
        disabled={disabled}
        interactionDisabled={taskSettings.loading}
      />

      <div className="mt-1 flex min-w-0 flex-col gap-1">
        <MicroLabel className="text-foreground-passive">
          {t('settings.tasks.summaryLanguageLabel')}
        </MicroLabel>
        <Select
          value={taskSettings.summaryLanguage}
          onValueChange={(value) =>
            taskSettings.updateSummaryLanguage(value as typeof taskSettings.summaryLanguage)
          }
          disabled={disabled}
        >
          <SelectTrigger size="sm" className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">{t('settings.tasks.namingLanguageSkip')}</SelectItem>
            <SelectItem value="app">{t('settings.tasks.namingLanguageApp')}</SelectItem>
            <SelectItem value="prompt">{t('settings.tasks.namingLanguagePrompt')}</SelectItem>
            <SelectItem value="zh-CN">{t('settings.tasks.namingLanguageZh')}</SelectItem>
            <SelectItem value="en">{t('settings.tasks.namingLanguageEn')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SummaryContextGroup scope="recent" disabled={disabled} />
      <SummaryContextGroup scope="global" disabled={disabled} />
    </div>
  );
});

/** Context-source checkboxes for one summary scope (recent / global). */
const SummaryContextGroup = observer(function SummaryContextGroup({
  scope,
  disabled,
}: {
  scope: 'recent' | 'global';
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const context =
    scope === 'recent' ? taskSettings.summaryContextRecent : taskSettings.summaryContextGlobal;
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1.5">
      <MicroLabel className="text-foreground-passive">
        {t(`settings.tasks.summaryContext.${scope}Label`)}
      </MicroLabel>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs text-foreground-muted">
        {SUMMARY_CONTEXT_SOURCE_IDS.map((id) => (
          <label key={id} className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={context[id]}
              disabled={disabled}
              onCheckedChange={(checked) =>
                taskSettings.updateSummaryContext(scope, { [id]: checked === true })
              }
            />
            <span className="truncate">{t(`settings.tasks.summaryContext.source.${id}`)}</span>
          </label>
        ))}
      </div>
    </div>
  );
});
