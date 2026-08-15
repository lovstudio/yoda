import {
  isBuiltinTeamId,
  normalizeTeamMembers,
  normalizeTeamRouting,
  type AgentTeam,
  type AgentTeamDraft,
} from '../agent-team';
import { normalizeTeamCommunicationConfig } from '../team-communication';
import { normalizeRoutingHopLimit } from '../team-routing-limit';
import type { Paradigm, ParadigmDraft } from './paradigm';
import { teamParadigmParamsSchema, type TeamParadigmParams } from './params';

/**
 * Agent Teams as paradigm instances.
 *
 * A team was always an instance of the multi-agent paradigm — a renameable,
 * duplicable, parameterized template — it just predated the vocabulary and got
 * its own table. These convert between the two representations so `agent_teams`
 * can be folded into `paradigms` without touching the team-room code that still
 * speaks `AgentTeam`.
 *
 * The team's id carries over unchanged: rooms reference it, so re-keying would
 * orphan every existing room.
 */

/** A team's roster and wiring, as `team` kind params. */
export function teamToParadigmParams(team: AgentTeamDraft): TeamParadigmParams {
  return teamParadigmParamsSchema.parse({
    routing: team.routing,
    communication: team.communication,
    routingHopLimit: team.routingHopLimit,
    members: team.members,
  });
}

/**
 * A team as a paradigm draft.
 *
 * The name and icon fall back here rather than in the paradigms service: an empty
 * label there means "use the kind's own localized name", which for a team would
 * render every unnamed team as 「多智能体」. A team has always had its own
 * placeholder, so it is applied before crossing over.
 */
export function teamToParadigmDraft(team: AgentTeamDraft): ParadigmDraft {
  return {
    kindId: 'team',
    label: team.name.trim() || 'Untitled team',
    icon: team.icon.trim() || '👥',
    params: teamToParadigmParams(team),
  };
}

/**
 * Read a paradigm instance back as a team.
 *
 * Tolerant of params that predate or postdate the current schema for the same
 * reason the schema itself repairs rather than rejects: the roster is user data
 * that cannot be regenerated.
 */
export function paradigmToTeam(paradigm: Paradigm): AgentTeam {
  const params = (paradigm.params ?? {}) as Partial<TeamParadigmParams>;
  return {
    id: paradigm.id,
    name: paradigm.label,
    icon: paradigm.icon,
    routing: normalizeTeamRouting(params.routing),
    routingHopLimit: normalizeRoutingHopLimit(params.routingHopLimit),
    communication: normalizeTeamCommunicationConfig(params.communication),
    // Shipped with the app, which is what `builtin` has always meant for a team:
    // editable, but not deletable.
    builtin: isBuiltinTeamId(paradigm.id),
    members: normalizeTeamMembers(Array.isArray(params.members) ? params.members : []),
    createdAt: paradigm.createdAt,
    updatedAt: paradigm.updatedAt,
  };
}

/** A built-in team as its code-defined paradigm instance. */
export function builtinTeamToParadigm(team: AgentTeam): Paradigm {
  return {
    id: team.id,
    kindId: 'team',
    label: team.name,
    icon: team.icon,
    params: teamToParadigmParams(team),
    builtin: true,
    sortOrder: 0,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}
