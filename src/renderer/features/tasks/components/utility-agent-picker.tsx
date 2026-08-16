import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useAgents } from '@renderer/features/agents-config/use-agents';
import { AgentPicker } from '@renderer/lib/components/agent-picker/agent-picker';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';

/**
 * Binds an Agent to one of the app's internal AI utilities — prompt rewrite,
 * session naming, session summary. Every such utility resolves its runtime,
 * model and system prompt from an Agent, so they all pick one the same way:
 * this single control, so the three never drift apart in behavior or looks.
 *
 * Picking is `AgentPicker`, the app-wide Agent picker — searching, creating and
 * forking an Agent work here exactly as they do on a roster seat. This component
 * only adds the label and hint a settings row needs.
 *
 * An empty selection means "use the built-in Agent for this utility".
 */
export const UtilityAgentPicker = observer(function UtilityAgentPicker({
  label,
  hint,
  agentId,
  onAgentIdChange,
  disabled,
  className,
}: {
  label: string;
  hint?: string;
  agentId: string;
  onAgentIdChange: (agentId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { agents } = useAgents();

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <MicroLabel className="text-foreground-passive">{label}</MicroLabel>
      <AgentPicker
        size="sm"
        selectedAgent={agents.find((agent) => agent.id === agentId) ?? null}
        agents={agents}
        onSelect={(agent) => onAgentIdChange(agent.id)}
        placeholder={t('home.slotPickAgent')}
        disabled={disabled}
      />
      {hint ? <p className="text-[11px] leading-relaxed text-foreground-passive">{hint}</p> : null}
    </div>
  );
});
