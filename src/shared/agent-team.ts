import { isValidRuntimeId, type RuntimeId } from './runtime-registry';
import { type TeamCommunicationConfig } from './team-communication';
import { type RoutingHopLimit } from './team-routing-limit';

/**
 * An Agent Team is a reusable, project/task-decoupled template (like an Agent) —
 * a "development paradigm" surfaced in the home composer's run-mode picker as
 * 「多智能体（team name）」. Running it reuses the existing `team` launch: the
 * leader runs first, then its output is handed to the workers.
 */
export type TeamMemberRole = 'leader' | 'worker';

/**
 * How the team collaborates when run as a chat room (drives the @-routing role
 * prompts seeded into members):
 * - `review-loop`: leader hands to workers, workers loop fixes back until they pass.
 * - `fan-out`: leader plans, @mentions every worker once, workers report back.
 * - `sequential`: leader advances one evidence-backed stage at a time.
 * - `freeform`: no scripted routing — just the generic teammate etiquette.
 */
export const TEAM_ROUTINGS = ['review-loop', 'fan-out', 'sequential', 'freeform'] as const;

export type TeamRouting = (typeof TEAM_ROUTINGS)[number];

export interface AgentTeamMember {
  /** Stable id within the team; also the slot key suffix at launch. */
  handle: string;
  displayName: string;
  /** Optional member-specific avatar, primarily used by inline team roles. */
  icon?: string;
  role: TeamMemberRole;
  /** Runtime the member's conversation spawns on. */
  runtime: RuntimeId;
  /**
   * Resolve the member's system prompt from this agent — a built-in agent key
   * (`builtin:*`) or a user Agent id. Takes precedence over `systemPrompt`.
   */
  agentRef?: string;
  /** Inline system prompt when there's no agentRef. */
  systemPrompt?: string;
}

export interface AgentTeam {
  id: string;
  name: string;
  /** Emoji/glyph, image URL, or data URL avatar (matches Agent.icon). */
  icon: string;
  routing: TeamRouting;
  communication: TeamCommunicationConfig;
  /** Max conductor routing deliveries per human prompt. null = unlimited. */
  routingHopLimit: RoutingHopLimit;
  members: AgentTeamMember[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTeamDraft {
  name: string;
  icon: string;
  routing: TeamRouting;
  communication: TeamCommunicationConfig;
  routingHopLimit: RoutingHopLimit;
  members: AgentTeamMember[];
}

/**
 * The roster invariants: every handle unique and non-empty, every runtime real,
 * exactly one leader.
 *
 * This is shared rather than service-local because a team is also a paradigm
 * instance, and the paradigms write path validates through the kind's params
 * schema. Were the invariants to stay behind `agentTeamsService`, writing the
 * same team through `paradigms.update` would quietly skip them.
 *
 * Deliberately total: it repairs rather than rejects, because it also runs on the
 * read path, where the alternative to a repaired roster is a lost one.
 */
export function normalizeTeamMembers(members: readonly AgentTeamMember[]): AgentTeamMember[] {
  const seen = new Set<string>();
  const clean = members.map((member, index) => {
    let handle = (member.handle || `member-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!handle) handle = `member-${index + 1}`;
    while (seen.has(handle)) handle = `${handle}-${index + 1}`;
    seen.add(handle);
    return {
      handle,
      displayName: member.displayName?.trim() || handle,
      icon: member.icon?.trim() || undefined,
      role: member.role === 'leader' ? 'leader' : 'worker',
      runtime: isValidRuntimeId(member.runtime) ? member.runtime : 'claude',
      agentRef: member.agentRef,
      systemPrompt: member.systemPrompt,
    } satisfies AgentTeamMember;
  });
  // Exactly one leader: the first one declared, else the first member.
  const leaderIndex = clean.findIndex((member) => member.role === 'leader');
  return clean.map((member, index) => ({
    ...member,
    role: index === (leaderIndex === -1 ? 0 : leaderIndex) ? 'leader' : 'worker',
  }));
}

export function normalizeTeamRouting(value: unknown): TeamRouting {
  return TEAM_ROUTINGS.includes(value as TeamRouting) ? (value as TeamRouting) : 'freeform';
}

/** The leader member of a team (first leader, or the first member as a fallback). */
export function teamLeader(team: AgentTeam): AgentTeamMember | undefined {
  return team.members.find((m) => m.role === 'leader') ?? team.members[0];
}

export function teamWorkers(team: AgentTeam): AgentTeamMember[] {
  const leader = teamLeader(team);
  return team.members.filter((m) => m !== leader);
}
