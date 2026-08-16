import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { SUMMARY_CONTEXT_SOURCE_IDS } from '@shared/session-summary';
import {
  TASK_LANGUAGE_OPTIONS,
  TaskLanguageSelect,
} from '@renderer/features/tasks/components/task-language-select';
import { UtilityAgentPicker } from '@renderer/features/tasks/components/utility-agent-picker';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { MicroLabel } from '@renderer/lib/ui/label';
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

      <TaskLanguageSelect
        label={t('settings.tasks.summaryLanguageLabel')}
        value={taskSettings.summaryLanguage}
        options={TASK_LANGUAGE_OPTIONS}
        // Not `saving`: a controlled Select disabled mid-save makes base-ui
        // abort the value change, so the selection visibly reverts.
        disabled={taskSettings.loading}
        onValueChange={taskSettings.updateSummaryLanguage}
        className="mt-1"
      />

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
