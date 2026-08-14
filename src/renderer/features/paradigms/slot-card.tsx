import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@shared/agents';
import type { ParadigmIconId } from '@shared/paradigms/contract';
import { useSkills } from '@renderer/features/skills/components/useSkills';
import { AgentSlotSelector } from '@renderer/lib/components/agent-slot/agent-slot-selector';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ParadigmIcon } from './icons';

export interface ParadigmSlotCardProps {
  iconId: ParadigmIconId;
  label: string;
  /** User Agents this slot can pick from. */
  agents: Agent[];
  /** Currently selected Agent id for this slot, or null when none chosen yet. */
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onConfigurationChange: () => void;
}

/**
 * One Agent seat in a paradigm's configuration panel: the assigned Agent's
 * identity and configured skills, editable in place. Every paradigm renders its
 * seats through this card so an Agent looks the same wherever it is assigned.
 */
export function ParadigmSlotCard({
  iconId,
  label,
  agents,
  selectedAgentId,
  onSelectAgent,
  onConfigurationChange,
}: ParadigmSlotCardProps) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showAgentModal = useShowModal('agentEditModal');
  const { installedSkills } = useSkills();

  const selectedAgent = selectedAgentId
    ? (agents.find((a) => a.id === selectedAgentId) ?? null)
    : null;
  const resolveSkillName = (identifier: string) =>
    installedSkills.find((skill) => skill.key === identifier || skill.id === identifier)
      ?.displayName ?? identifier;
  const skillNames = selectedAgent
    ? [
        ...selectedAgent.enabledSkillIds.map((identifier) => resolveSkillName(identifier)),
        ...selectedAgent.manualSkillIds.map(
          (identifier) => `${resolveSkillName(identifier)} · ${t('agentManager.skillModeManual')}`
        ),
      ]
    : [];
  const editAgent = () =>
    selectedAgent &&
    showAgentModal({ agent: selectedAgent, onSuccess: () => onConfigurationChange() });

  return (
    <div className="group flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-background-1 p-2 transition-colors hover:border-border focus-within:border-border-1">
      {/* Subject row: avatar + (role eyebrow over agent name) + edit. Folding the
          role label into the picker keeps the whole assignment on one row. */}
      <div className="flex min-w-0 items-center gap-1">
        <AgentSlotSelector
          selectedAgent={selectedAgent}
          agents={agents}
          onSelectAgent={onSelectAgent}
          onCreateAgent={() =>
            showAgentModal({ onSuccess: (created) => onSelectAgent(created.id) })
          }
          onManageAgents={() => navigate('agentManager')}
          eyebrow={
            <span
              title={label}
              className="flex items-center gap-1 truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-foreground-passive"
            >
              <ParadigmIcon iconId={iconId} className="size-3 shrink-0" />
              {label}
            </span>
          }
          className="h-auto min-w-0 flex-1 rounded-lg border-transparent bg-transparent py-1 pl-1 pr-1.5 hover:bg-background-2/60"
        />
        {selectedAgent && (
          <button
            type="button"
            onClick={editAgent}
            aria-label={t('agentManager.editAgent')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
          </button>
        )}
      </div>

      {selectedAgent && (
        <>
          {selectedAgent.description && (
            <p className="line-clamp-2 px-1 text-xs leading-snug text-foreground-muted">
              {selectedAgent.description}
            </p>
          )}
          {skillNames.length > 0 && (
            <div className="flex flex-wrap gap-1 px-1">
              {skillNames.map((name, index) => (
                <span
                  key={`${name}-${index}`}
                  className="max-w-40 truncate rounded-full bg-background-2/70 px-2 py-0.5 text-[10px] font-medium text-foreground-muted"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
