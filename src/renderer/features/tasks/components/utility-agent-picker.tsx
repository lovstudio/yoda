import { Plus, Settings2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
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
 * Binds an Agent to one of the app's internal AI utilities — prompt rewrite,
 * session naming, session summary. Every such utility resolves its runtime,
 * model and system prompt from an Agent, so they all pick one the same way:
 * this single control, so the three never drift apart in behavior or looks.
 *
 * An empty selection means "use the built-in Agent for this utility".
 */
export const UtilityAgentPicker = observer(function UtilityAgentPicker({
  label,
  hint,
  agentId,
  onAgentIdChange,
  disabled,
  /**
   * Separate from `disabled` on purpose: a controlled Select must NOT be
   * disabled mid-save, because toggling `disabled` between the click and
   * React's commit makes base-ui abort the value change and the selection
   * visibly reverts. Pass the flag that excludes a transient `saving`.
   */
  interactionDisabled = disabled,
  className,
}: {
  label: string;
  hint?: string;
  agentId: string;
  onAgentIdChange: (agentId: string) => void;
  disabled?: boolean;
  interactionDisabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { agents } = useAgents();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');

  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <MicroLabel className="text-foreground-passive">{label}</MicroLabel>
      {agents.length === 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          className="h-8 w-full justify-start gap-1.5"
          onClick={() => showAgentModal({ onSuccess: (created) => onAgentIdChange(created.id) })}
        >
          <Plus className="size-3.5" />
          {t('home.slotNoAgents')}
        </Button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <Select
            value={selectedAgent?.id ?? ''}
            onValueChange={(value) => onAgentIdChange(value as string)}
            disabled={interactionDisabled}
          >
            <SelectTrigger size="sm" className="h-8 min-w-0 flex-1">
              <SelectValue placeholder={t('home.slotPickAgent')}>
                {() =>
                  selectedAgent ? (
                    <AgentOptionLabel icon={selectedAgent.icon} name={selectedAgent.name} />
                  ) : (
                    t('home.slotPickAgent')
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id} label={agent.name}>
                  <AgentOptionLabel icon={agent.icon} name={agent.name} />
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
      {hint ? <p className="text-[11px] leading-relaxed text-foreground-passive">{hint}</p> : null}
    </div>
  );
});

function AgentOptionLabel({ icon, name }: { icon?: string; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex size-4 shrink-0 items-center justify-center text-[13px] leading-none">
        {icon || '🤖'}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
