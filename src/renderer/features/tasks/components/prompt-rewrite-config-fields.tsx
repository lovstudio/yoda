import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { UtilityAgentPicker } from '@renderer/features/tasks/components/utility-agent-picker';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { cn } from '@renderer/utils/utils';

/**
 * Configuration for rewriting the user's prompt before it is sent. Like naming
 * and summary, the work runs on an Agent, so the same picker binds one here —
 * the target language stays on the row itself, since `skip` is what turns the
 * whole capability off.
 */
export const PromptRewriteConfigFields = observer(function PromptRewriteConfigFields({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const off = taskSettings.inputPromptLanguage === 'skip';
  const disabled = taskSettings.loading || taskSettings.saving || off;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <UtilityAgentPicker
        label={t('settings.tasks.promptRewriteAgentLabel')}
        hint={t('settings.tasks.promptRewriteAgentHint')}
        agentId={taskSettings.promptRewriteAgentId}
        onAgentIdChange={taskSettings.updatePromptRewriteAgentId}
        disabled={disabled}
        interactionDisabled={taskSettings.loading || off}
      />
    </div>
  );
});
