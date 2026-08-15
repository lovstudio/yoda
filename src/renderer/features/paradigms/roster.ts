import { normalizeTeamMembers, type AgentTeamMember, type TeamRouting } from '@shared/agent-team';
import { DEFAULT_AGENT_ICON, type Agent } from '@shared/agents';
import { BUILTIN_AGENT_PRESETS, BUILTIN_AGENT_SLUG_PREFIX } from '@shared/builtin-agents';
import { paradigmKind } from '@shared/paradigms/kinds';
import type { Paradigm, ParadigmDraft } from '@shared/paradigms/paradigm';
import { withParadigmSlotAgent, type TeamParadigmParams } from '@shared/paradigms/params';
import { paradigmToTeam, teamToParadigmParams } from '@shared/paradigms/team-adapter';
import { paradigmSeatAgentId } from './seats';

/**
 * A paradigm as a roster of Agents, in both directions.
 *
 * A paradigm is a way of working, and a way of working is a set of Agents — one
 * for vibe coding, three for a review pipeline. The kinds store that set two
 * different ways for historical reasons (`single` in a fixed seat, `team` in a
 * members array), which is why "add another Agent" used to be impossible in one
 * of them and the user had to pick a category up front.
 *
 * These functions make the roster the single thing the configuration UI edits and
 * let the kind fall out of its size: one Agent is a `single` paradigm, two or more
 * is a `team`. Nobody has to be told.
 *
 * This lives in the renderer because reading a seat into a member needs the Agent
 * rows and the composer draft — the seat only stores an id.
 */

/** The stored Agent behind a member: a user Agent by id, a built-in by slug. */
export function findReferencedAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  if (!member.agentRef) return null;
  return (
    agents.find((agent) =>
      member.agentRef?.startsWith(BUILTIN_AGENT_SLUG_PREFIX)
        ? agent.slug === member.agentRef
        : agent.id === member.agentRef
    ) ?? null
  );
}

/**
 * A roster member's Agent, for display.
 *
 * Resolution order is the member's own: a user Agent by id, a built-in by stable
 * slug, then an inline prompt. Returns null when the member references an Agent
 * that no longer exists and carries no prompt of its own — the row still renders,
 * it just has nothing to describe.
 *
 * A real Agent row comes back as itself, id included, so that editing it from a
 * roster row edits the same record the Agent manager does. Only a member with no
 * row behind it (a preset whose seeding has not run, or an inline prompt) gets a
 * synthesized stand-in, which is display-only.
 */
export function rosterAgent(member: AgentTeamMember, agents: Agent[]): Agent | null {
  const referenced = findReferencedAgent(member, agents);
  if (referenced) return referenced;
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
 * An Agent as a roster member.
 *
 * Built-in Agents are referenced by slug rather than row id: their rows are seeded
 * per install, so a slug is the only reference that means the same thing in a
 * shipped default as it does in a user's copy.
 */
export function agentAsMember(agent: Agent, role: AgentTeamMember['role']): AgentTeamMember {
  return {
    handle: agent.slug,
    displayName: agent.name,
    role,
    runtime: agent.preferredRuntime ?? 'claude',
    agentRef: agent.slug.startsWith(BUILTIN_AGENT_SLUG_PREFIX) ? agent.slug : agent.id,
  };
}

/**
 * The roster a paradigm instance currently describes.
 *
 * `team` reads its members directly. Every other kind reads its seats, which is
 * what makes a one-Agent paradigm editable in the same table as a five-Agent one —
 * including the seat's three-layer fallback, so an instance nobody has configured
 * still shows the Agent it would actually run.
 */
export function paradigmRoster({
  paradigm,
  agents,
  draftAgents,
}: {
  paradigm: Paradigm | undefined;
  agents: Agent[];
  draftAgents: Record<string, string[]>;
}): AgentTeamMember[] {
  if (!paradigm) return [];
  if (paradigm.kindId === 'team') return paradigmToTeam(paradigm).members;
  return paradigmKind(paradigm.kindId)
    .slots.map((slot) => {
      const agentId = paradigmSeatAgentId({
        paradigm,
        slotStorageKey: slot.storageKey,
        draftAgents,
        agents,
      });
      const agent = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
      return agent ? agentAsMember(agent, 'leader') : null;
    })
    .filter((member): member is AgentTeamMember => member !== null);
}

/** The kind a roster of this size is: one Agent works alone, several are a team. */
export function rosterKindId(members: readonly AgentTeamMember[]): 'single' | 'team' {
  return members.length >= 2 ? 'team' : 'single';
}

/**
 * A paradigm rewritten around a roster.
 *
 * Crossing between one Agent and several changes the kind, because the kinds store
 * a roster differently — and going down to one drops the team wiring (routing,
 * communication, hop limit) along with it, since `singleParadigmParamsSchema` has
 * nowhere to put fields that only describe how members hand work to each other.
 * That is the intended reading: with one Agent there is no handoff to configure.
 *
 * Two cases deliberately stay a `team`:
 * - a sole member that resolves to no Agent row (a legacy inline-prompt role) —
 *   its prompt lives in the member and a seat can only hold an id, so downgrading
 *   would delete it;
 * - a kind that is neither `single` nor `team` (`compare` wraps a paradigm rather
 *   than holding a roster) is returned untouched.
 */
export function rosterDraft({
  paradigm,
  members,
  agents,
  label,
  icon,
}: {
  paradigm: Paradigm;
  members: readonly AgentTeamMember[];
  agents: Agent[];
  label?: string;
  icon?: string;
}): ParadigmDraft {
  const presentation = {
    label: label ?? paradigm.label,
    icon: icon ?? paradigm.icon,
  };
  if (paradigm.kindId !== 'single' && paradigm.kindId !== 'team')
    return { kindId: paradigm.kindId, ...presentation, params: paradigm.params };

  const normalized = normalizeTeamMembers(members);
  const sole = normalized.length === 1 ? normalized[0] : undefined;
  const soleAgent = sole ? findReferencedAgent(sole, agents) : null;

  if (normalized.length >= 2 || (sole && !soleAgent)) {
    // Team wiring survives the crossing when the instance already had some;
    // otherwise the kind's own defaults apply, minus their shipped roster.
    const existing: Pick<TeamParadigmParams, 'routing' | 'communication' | 'routingHopLimit'> =
      paradigm.kindId === 'team'
        ? paradigmToTeam(paradigm)
        : (paradigmKind('team').defaultParams as TeamParadigmParams);
    return {
      kindId: 'team',
      ...presentation,
      params: teamToParadigmParams({
        name: presentation.label,
        icon: presentation.icon,
        routing: existing.routing as TeamRouting,
        communication: existing.communication,
        routingHopLimit: existing.routingHopLimit,
        members: normalized,
      }),
    };
  }

  const seat = paradigmKind('single').slots[0];
  return {
    kindId: 'single',
    ...presentation,
    params: soleAgent ? withParadigmSlotAgent({}, seat.storageKey, soleAgent.id) : { agents: {} },
  };
}
