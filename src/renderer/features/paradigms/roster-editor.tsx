import { Crown, MoreHorizontal, Settings2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTeamMemberEnabled,
  withTeamMemberEnabled,
  type AgentTeamMember,
} from '@shared/agent-team';
import type { Agent } from '@shared/agents';
import type { ParadigmIconId } from '@shared/paradigms/contract';
import { useSkills } from '@renderer/features/skills/components/useSkills';
import { AgentPicker } from '@renderer/lib/components/agent-picker/agent-picker';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { cn } from '@renderer/utils/utils';
import { ParadigmIcon } from './icons';
import { agentAsMember, findReferencedAgent, rosterAgent } from './roster';

/**
 * A paradigm's roster: the Agents it runs with, as one editable list.
 *
 * This is the whole configuration surface for what a paradigm *is*. One row is one
 * Agent working alone; add a second and the same list describes a team. The user
 * never picks between those two — the list is the same list either way, which is
 * the point.
 *
 * Rows carry a checkbox rather than only a remove button because a roster is worth
 * assembling once and running subsets of: unchecking is how you skip a reviewer for
 * one task without losing the reviewer.
 */
export function ParadigmRosterEditor({
  members,
  agents,
  soleSlotLabel,
  soleSlotIconId,
  onChange,
  onConfigurationChange,
}: {
  members: AgentTeamMember[];
  agents: Agent[];
  /** What the one seat is called while the roster holds a single Agent. */
  soleSlotLabel: string;
  soleSlotIconId: ParadigmIconId;
  onChange: (members: AgentTeamMember[]) => void;
  onConfigurationChange: () => void;
}) {
  const { t } = useTranslation();
  const showAgentModal = useShowModal('agentEditModal');

  const multiple = members.length > 1;
  const enabledCount = members.filter(isTeamMemberEnabled).length;
  const rostered = new Set(
    members
      .map((member) => findReferencedAgent(member, agents)?.id)
      .filter((id): id is string => id !== undefined)
  );
  const available = agents.filter((agent) => !rostered.has(agent.id));

  const replaceAt = (index: number, member: AgentTeamMember) =>
    onChange(members.map((current, i) => (i === index ? member : current)));

  return (
    <div className="flex flex-col gap-1.5">
      {members.map((member, index) => (
        <RosterRow
          key={`${member.handle}-${index}`}
          member={member}
          agents={agents}
          multiple={multiple}
          // The last Agent still running cannot be switched off: a paradigm with
          // nobody in it has nothing to launch, and refusing here is quieter than
          // explaining it afterwards.
          lastEnabled={isTeamMemberEnabled(member) && enabledCount <= 1}
          eyebrow={
            multiple ? (
              <span className="flex items-center gap-1 truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-foreground-passive">
                {member.role === 'leader' && <Crown className="size-3 shrink-0" />}
                {t(member.role === 'leader' ? 'agentTeams.leaderRole' : 'agentTeams.workerRole')}
              </span>
            ) : (
              <span
                title={soleSlotLabel}
                className="flex items-center gap-1 truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-foreground-passive"
              >
                <ParadigmIcon iconId={soleSlotIconId} className="size-3 shrink-0" />
                {soleSlotLabel}
              </span>
            )
          }
          onSelectAgent={(agent) =>
            replaceAt(index, {
              ...agentAsMember(agent, member.role),
              ...(isTeamMemberEnabled(member) ? {} : { enabled: false as const }),
            })
          }
          onToggleEnabled={(enabled) => replaceAt(index, withTeamMemberEnabled(member, enabled))}
          onMakeLeader={() =>
            onChange(
              members.map((current, i) => ({
                ...current,
                role: i === index ? 'leader' : 'worker',
              }))
            )
          }
          onRemove={() => onChange(members.filter((_, i) => i !== index))}
          onEditAgent={(agent) =>
            showAgentModal({ agent, onSuccess: () => onConfigurationChange() })
          }
        />
      ))}

      {/* Adding is the same picker a row uses, with nothing selected — so the way
          you choose the first Agent is the way you choose the fourth. */}
      <AgentPicker
        selectedAgent={null}
        agents={available}
        placeholder={t('agentTeams.addMember')}
        onSelect={(agent) =>
          onChange([...members, agentAsMember(agent, members.length === 0 ? 'leader' : 'worker')])
        }
        className="h-auto rounded-xl border border-dashed border-border/60 py-2 pl-2 pr-2.5 hover:bg-background-2/60"
      />

      {/* The two rules the list follows, where a rule belongs: after it, small. */}
      <p className="px-1 text-[11px] leading-relaxed text-foreground-passive">
        {multiple ? t('agentTeams.rosterHintTeam') : t('agentTeams.rosterHintSolo')}
      </p>
    </div>
  );
}

function RosterRow({
  member,
  agents,
  multiple,
  lastEnabled,
  eyebrow,
  onSelectAgent,
  onToggleEnabled,
  onMakeLeader,
  onRemove,
  onEditAgent,
}: {
  member: AgentTeamMember;
  agents: Agent[];
  multiple: boolean;
  lastEnabled: boolean;
  eyebrow: ReactNode;
  onSelectAgent: (agent: Agent) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onMakeLeader: () => void;
  onRemove: () => void;
  onEditAgent: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const { installedSkills } = useSkills();

  const enabled = isTeamMemberEnabled(member);
  const resolved = rosterAgent(member, agents);
  // Only a real row can be edited; a preset stand-in or an inline role has no
  // record behind it, and opening an editor on one would write nowhere.
  const editable = findReferencedAgent(member, agents);
  const resolveSkillName = (identifier: string) =>
    installedSkills.find((skill) => skill.key === identifier || skill.id === identifier)
      ?.displayName ?? identifier;
  const skillNames = resolved
    ? [
        ...resolved.enabledSkillIds.map((identifier) => resolveSkillName(identifier)),
        ...resolved.manualSkillIds.map(
          (identifier) => `${resolveSkillName(identifier)} · ${t('agentManager.skillModeManual')}`
        ),
      ]
    : [];

  return (
    <div
      className={cn(
        'group flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-background-1 p-2 transition-colors hover:border-border focus-within:border-border-1',
        // A switched-off member is still on the list, just visibly not running.
        !enabled && 'opacity-55'
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {multiple && (
          <span
            className="flex size-7 shrink-0 items-center justify-center"
            title={lastEnabled ? t('agentTeams.lastEnabledMember') : t('agentTeams.memberEnabled')}
          >
            <Checkbox
              checked={enabled}
              disabled={lastEnabled}
              aria-label={t('agentTeams.memberEnabled')}
              onCheckedChange={(next) => onToggleEnabled(next === true)}
            />
          </span>
        )}
        <AgentPicker
          selectedAgent={resolved}
          agents={agents}
          onSelect={onSelectAgent}
          eyebrow={eyebrow}
          className="h-auto min-w-0 flex-1 rounded-lg border-transparent bg-transparent py-1 pl-1 pr-1.5 hover:bg-background-2/60"
        />
        {/* One menu rather than three icons: the row's job is to show who is on the
            list, and what can be done to them is secondary and open-ended. */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('common.more')}
            title={t('common.more')}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-passive transition-colors hover:bg-background-2 hover:text-foreground"
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {multiple && member.role !== 'leader' && enabled && (
              <DropdownMenuItem onClick={onMakeLeader}>
                <Crown className="size-3.5" />
                {t('agentTeams.makeLeader')}
              </DropdownMenuItem>
            )}
            {editable && (
              <DropdownMenuItem onClick={() => onEditAgent(editable)}>
                <Settings2 className="size-3.5" />
                {t('agentManager.editAgent')}
              </DropdownMenuItem>
            )}
            {/* The last Agent has no remove button: that is how "at least one"
                is enforced — by there being nothing to click. */}
            {multiple && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onRemove}>
                  <X className="size-3.5" />
                  {t('agentTeams.removeMember')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {resolved?.description && (
        <p className="line-clamp-2 px-1 text-xs leading-snug text-foreground-muted">
          {resolved.description}
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
    </div>
  );
}
