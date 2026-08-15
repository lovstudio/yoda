import { Crown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AgentTeamMember } from '@shared/agent-team';
import { DEFAULT_AGENT_ICON, type Agent } from '@shared/agents';
import { BUILTIN_AGENT_PRESETS } from '@shared/builtin-agents';
import { AgentCard } from '@renderer/lib/components/agent-card/agent-card';
import { AgentMetaRow } from '@renderer/lib/components/agent-card/agent-meta-row';
import { AgentInfoHover } from '@renderer/lib/components/agent-slot/agent-info-card';

/**
 * A roster member's Agent, for the card UI.
 *
 * Resolution order is the member's own: a user Agent by id, a built-in by stable
 * slug, then an inline prompt. A referenced Agent keeps its own client setting;
 * an inline role keeps the member's.
 */
export function findReferencedAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  if (!member.agentRef) return null;
  return (
    agents.find((agent) =>
      member.agentRef?.startsWith('builtin:')
        ? agent.slug === member.agentRef
        : agent.id === member.agentRef
    ) ?? null
  );
}

export function resolveMemberAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  let base: Pick<
    Agent,
    | 'name'
    | 'description'
    | 'icon'
    | 'systemPrompt'
    | 'enabledSkillIds'
    | 'manualSkillIds'
    | 'skillPolicyMode'
    | 'model'
    | 'preferredRuntime'
  > | null = null;
  if (member.agentRef) {
    const user = findReferencedAgent(member, agents);
    if (user) base = user;
    else {
      const preset = BUILTIN_AGENT_PRESETS.find((p) => p.key === member.agentRef);
      if (preset)
        base = {
          name: preset.name,
          description: preset.description,
          icon: preset.icon,
          systemPrompt: preset.systemPrompt,
          enabledSkillIds: [],
          manualSkillIds: [],
          skillPolicyMode: 'runtime-defaults',
          model: null,
          preferredRuntime: preset.preferredRuntime,
        };
    }
  }
  if (!base && member.systemPrompt) {
    base = {
      name: member.displayName,
      description: '',
      icon: member.icon ?? DEFAULT_AGENT_ICON,
      systemPrompt: member.systemPrompt,
      enabledSkillIds: [],
      manualSkillIds: [],
      skillPolicyMode: 'runtime-defaults',
      model: null,
      preferredRuntime: member.runtime,
    };
  }
  if (!base) return null;
  return {
    id: member.agentRef ?? member.handle,
    slug: member.handle,
    name: base.name,
    description: base.description,
    icon: base.icon,
    systemPrompt: base.systemPrompt,
    enabledSkillIds: base.enabledSkillIds,
    manualSkillIds: base.manualSkillIds,
    skillPolicyMode: base.skillPolicyMode,
    preferredRuntime: base.preferredRuntime,
    model: base.model,
    reasoningEffort: null,
    accessMode: 'inherit',
    source: 'local',
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * One roster member, as the same Agent card every other surface shows an Agent
 * with — identity, optional runtime and skills, full detail on hover. `trailing`
 * carries whatever controls the surface adds.
 */
export function MemberCard({
  member,
  agents,
  showRuntime = true,
  leaderBadge = true,
  trailing,
}: {
  member: AgentTeamMember;
  agents: Agent[];
  showRuntime?: boolean;
  leaderBadge?: boolean;
  trailing?: ReactNode;
}) {
  const resolved = resolveMemberAgent(member, agents);
  const skillCount = resolved
    ? resolved.enabledSkillIds.length + resolved.manualSkillIds.length
    : 0;

  const card = (
    <AgentCard
      name={member.displayName}
      icon={resolved?.icon}
      description={resolved?.description || undefined}
      badges={
        leaderBadge && member.role === 'leader' ? (
          <span className="flex shrink-0 items-center gap-1 rounded bg-primary/15 px-1.5 py-px text-[10px] text-primary">
            <Crown className="size-3" /> leader
          </span>
        ) : undefined
      }
      footer={
        showRuntime ? (
          <AgentMetaRow className="mt-0.5" runtime={member.runtime} skillCount={skillCount} />
        ) : undefined
      }
      trailing={trailing}
    />
  );

  return resolved ? <AgentInfoHover agent={resolved}>{card}</AgentInfoHover> : card;
}
