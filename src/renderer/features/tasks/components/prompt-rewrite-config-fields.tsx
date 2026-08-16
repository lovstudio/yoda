import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  PROMPT_REWRITE_LANGUAGE_OPTIONS,
  TaskLanguageSelect,
} from '@renderer/features/tasks/components/task-language-select';
import { UtilityAgentPicker } from '@renderer/features/tasks/components/utility-agent-picker';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { cn } from '@renderer/utils/utils';

/**
 * Configuration for rewriting the user's prompt before it is sent: which Agent
 * does the work, and what language it rewrites into. The capability's on/off
 * state lives on the row itself, as it does for naming and summary, so both
 * fields here read purely as parameters — and stay editable while it is off.
 */
export const PromptRewriteConfigFields = observer(function PromptRewriteConfigFields({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <UtilityAgentPicker
        label={t('settings.tasks.promptRewriteAgentLabel')}
        hint={t('settings.tasks.promptRewriteAgentHint')}
        agentId={taskSettings.promptRewriteAgentId}
        onAgentIdChange={taskSettings.updatePromptRewriteAgentId}
        disabled={taskSettings.loading}
      />
      <TaskLanguageSelect
        label={t('settings.tasks.inputPromptLanguageLabel')}
        value={taskSettings.inputPromptLanguage}
        options={PROMPT_REWRITE_LANGUAGE_OPTIONS}
        // A controlled Select must not be disabled mid-save, or base-ui aborts
        // the value change and the selection visibly reverts.
        disabled={taskSettings.loading}
        onValueChange={taskSettings.updateInputPromptLanguage}
        className="w-44"
      />
    </div>
  );
});
