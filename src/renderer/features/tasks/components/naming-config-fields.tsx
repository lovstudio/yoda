import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  MAX_TASK_NAMING_TIMEOUT_MS,
  MIN_TASK_NAMING_TIMEOUT_MS,
  normalizeTaskNamingTimeoutMs,
} from '@shared/task-naming';
import {
  TASK_LANGUAGE_OPTIONS,
  TaskLanguageSelect,
} from '@renderer/features/tasks/components/task-language-select';
import { UtilityAgentPicker } from '@renderer/features/tasks/components/utility-agent-picker';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

const CONTEXT_KEYS = ['prompt', 'project', 'readme', 'recentTasks'] as const;
const MIN_NAMING_TIMEOUT_SECONDS = Math.ceil(MIN_TASK_NAMING_TIMEOUT_MS / 1_000);
const MAX_NAMING_TIMEOUT_SECONDS = Math.floor(MAX_TASK_NAMING_TIMEOUT_MS / 1_000);

/**
 * Shared task-naming configuration controls (naming Agent, target language,
 * context sources). Rendered both in the Sessions settings tab and inline in
 * the task rename panel so the two surfaces stay aligned by construction.
 */
export const NamingConfigFields = observer(function NamingConfigFields({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const taskSettings = useTaskSettings();
  const disabled = taskSettings.loading || taskSettings.saving || !taskSettings.autoGenerateName;
  // Controlled inputs (Select) must NOT be disabled mid-save: toggling `disabled`
  // between the click and React's commit makes base-ui abort the value change,
  // so the selection visibly reverts. Optimistic updates keep the value live, so
  // omitting the transient `saving` flag here is safe.
  const interactionDisabled = taskSettings.loading || !taskSettings.autoGenerateName;

  const contextLabels: Record<(typeof CONTEXT_KEYS)[number], string> = {
    prompt: t('settings.tasks.namingContextPrompt'),
    project: t('settings.tasks.namingContextProject'),
    readme: t('settings.tasks.namingContextReadme'),
    recentTasks: t('settings.tasks.namingContextRecentTasks'),
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <UtilityAgentPicker
        label={t('settings.tasks.namingAgentLabel')}
        hint={t('settings.tasks.namingAgentHint')}
        agentId={taskSettings.namingAgentId}
        onAgentIdChange={taskSettings.updateNamingAgentId}
        disabled={disabled}
        interactionDisabled={interactionDisabled}
      />

      <div className={cn('flex min-w-0 gap-2', compact ? 'flex-col' : 'flex-wrap items-end')}>
        <TaskLanguageSelect
          label={t('settings.tasks.namingLanguageLabel')}
          value={taskSettings.namingLanguage}
          options={TASK_LANGUAGE_OPTIONS}
          disabled={interactionDisabled}
          onValueChange={taskSettings.updateNamingLanguage}
          className={compact ? 'min-w-0' : 'w-44 shrink-0'}
        />
        <Field
          label={t('settings.tasks.namingTimeoutLabel')}
          className={compact ? 'min-w-0' : 'w-28 shrink-0'}
        >
          <Input
            key={taskSettings.namingRequestTimeoutMs}
            type="number"
            min={MIN_NAMING_TIMEOUT_SECONDS}
            max={MAX_NAMING_TIMEOUT_SECONDS}
            step={5}
            defaultValue={Math.round(taskSettings.namingRequestTimeoutMs / 1_000)}
            disabled={disabled}
            aria-label={t('settings.tasks.namingTimeoutLabel')}
            onBlur={(e) => {
              const nextSeconds = clampNamingTimeoutSeconds(Number(e.target.value));
              e.target.value = String(nextSeconds);
              const nextMs = nextSeconds * 1_000;
              if (nextMs !== taskSettings.namingRequestTimeoutMs) {
                taskSettings.updateNamingRequestTimeoutMs(nextMs);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="h-8 w-full"
          />
        </Field>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <MicroLabel className="text-foreground-passive">
          {t('settings.tasks.namingContextLabel')}
        </MicroLabel>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-foreground-muted">
          {CONTEXT_KEYS.map((key) => (
            <label key={key} className="flex min-w-0 items-center gap-2">
              <Checkbox
                checked={taskSettings.namingContext[key]}
                disabled={interactionDisabled}
                onCheckedChange={(checked) =>
                  taskSettings.updateNamingContext({ [key]: checked === true })
                }
              />
              <span className="truncate">{contextLabels[key]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
});

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <MicroLabel className="text-foreground-passive">{label}</MicroLabel>
      {children}
    </div>
  );
}

function clampNamingTimeoutSeconds(value: number): number {
  return Math.round(normalizeTaskNamingTimeoutMs(value * 1_000) / 1_000);
}
