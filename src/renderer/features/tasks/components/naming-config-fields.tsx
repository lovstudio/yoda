import { Plus, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  MAX_TASK_NAMING_TIMEOUT_MS,
  MIN_TASK_NAMING_TIMEOUT_MS,
  normalizeTaskNamingTimeoutMs,
} from '@shared/task-naming';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Input } from '@renderer/lib/ui/input';
import { MicroLabel } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
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
  const { agents } = useAgents();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');
  const disabled = taskSettings.loading || taskSettings.saving || !taskSettings.autoGenerateName;
  // Controlled inputs (Select) must NOT be disabled mid-save: toggling `disabled`
  // between the click and React's commit makes base-ui abort the value change,
  // so the selection visibly reverts. Optimistic updates keep the value live, so
  // omitting the transient `saving` flag here is safe.
  const interactionDisabled = taskSettings.loading || !taskSettings.autoGenerateName;

  const selectedNamingAgent =
    agents.find((agent) => agent.id === taskSettings.namingAgentId) ?? null;

  const contextLabels: Record<(typeof CONTEXT_KEYS)[number], string> = {
    prompt: t('settings.tasks.namingContextPrompt'),
    project: t('settings.tasks.namingContextProject'),
    readme: t('settings.tasks.namingContextReadme'),
    recentTasks: t('settings.tasks.namingContextRecentTasks'),
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <Field label={t('settings.tasks.namingAgentLabel')} className="min-w-0">
        {agents.length === 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            className="h-8 w-full justify-start gap-1.5"
            onClick={() =>
              showAgentModal({
                onSuccess: (created) => taskSettings.updateNamingAgentId(created.id),
              })
            }
          >
            <Plus className="size-3.5" />
            {t('home.slotNoAgents')}
          </Button>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            <Select
              value={selectedNamingAgent?.id ?? ''}
              onValueChange={(value) => taskSettings.updateNamingAgentId(value as string)}
              disabled={interactionDisabled}
            >
              <SelectTrigger size="sm" className="h-8 min-w-0 flex-1">
                <SelectValue placeholder={t('home.slotPickAgent')}>
                  {() =>
                    selectedNamingAgent ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
                          {selectedNamingAgent.icon || '🤖'}
                        </span>
                        <span className="truncate">{selectedNamingAgent.name}</span>
                      </span>
                    ) : (
                      t('home.slotPickAgent')
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id} label={agent.name}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
                        {agent.icon || '🤖'}
                      </span>
                      <span className="truncate">{agent.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={t('home.slotManageAgents')}
              title={t('home.slotManageAgents')}
              onClick={() => navigate('agentManager')}
            >
              <Settings2 className="size-3.5" />
            </Button>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-foreground-passive">
          {t('settings.tasks.namingAgentHint')}
        </p>
      </Field>

      <div className={cn('flex min-w-0 gap-2', compact ? 'flex-col' : 'flex-wrap items-end')}>
        <Field
          label={t('settings.tasks.namingLanguageLabel')}
          className={compact ? 'min-w-0' : 'w-44 shrink-0'}
        >
          <Select
            value={taskSettings.namingLanguage}
            onValueChange={(value) =>
              taskSettings.updateNamingLanguage(value as typeof taskSettings.namingLanguage)
            }
            disabled={interactionDisabled}
          >
            <SelectTrigger size="sm" className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="app">{t('settings.tasks.namingLanguageApp')}</SelectItem>
              <SelectItem value="prompt">{t('settings.tasks.namingLanguagePrompt')}</SelectItem>
              <SelectItem value="zh-CN">{t('settings.tasks.namingLanguageZh')}</SelectItem>
              <SelectItem value="en">{t('settings.tasks.namingLanguageEn')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
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
