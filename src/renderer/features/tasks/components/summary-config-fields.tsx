import { Plus, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { SUMMARY_CONTEXT_SOURCE_IDS } from '@shared/session-summary';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { useTaskSettings } from '@renderer/features/tasks/hooks/useTaskSettings';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
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
  const { agents } = useAgents();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');
  const disabled = taskSettings.loading || taskSettings.saving;

  const selectedAgent = agents.find((agent) => agent.id === taskSettings.summaryAgentId) ?? null;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <MicroLabel className="text-foreground-passive">
        {t('settings.tasks.summaryAgentLabel')}
      </MicroLabel>
      {agents.length === 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          className="h-8 w-full justify-start gap-1.5"
          onClick={() =>
            showAgentModal({
              onSuccess: (created) => taskSettings.updateSummaryAgentId(created.id),
            })
          }
        >
          <Plus className="size-3.5" />
          {t('home.slotNoAgents')}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            value={selectedAgent?.id ?? ''}
            onValueChange={(value) => taskSettings.updateSummaryAgentId(value as string)}
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="h-8 min-w-0 flex-1">
              <SelectValue placeholder={t('home.slotPickAgent')}>
                {() =>
                  selectedAgent ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
                        {selectedAgent.icon || '🤖'}
                      </span>
                      <span className="truncate">{selectedAgent.name}</span>
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
        {t('settings.tasks.summaryAgentHint')}
      </p>

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
