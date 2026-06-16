import { BUILTIN_AGENT_KEYS } from './builtin-agents';
import type { RuntimeId } from './runtime-registry';

/**
 * An Agent Team is a reusable, project/task-decoupled template (like an Agent) —
 * a "development paradigm" surfaced in the home composer's run-mode picker as
 * 「多智能体（team name）」. Running it reuses the existing `team` launch: the
 * leader runs first, then its output is handed to the workers.
 */
export type TeamMemberRole = 'leader' | 'worker';

export interface AgentTeamMember {
  /** Stable id within the team; also the slot key suffix at launch. */
  handle: string;
  displayName: string;
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
  /** Emoji/glyph avatar (matches Agent.icon). */
  icon: string;
  /** Code-defined built-ins are not editable/deletable. */
  builtin: boolean;
  members: AgentTeamMember[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentTeamDraft {
  name: string;
  icon: string;
  members: AgentTeamMember[];
}

export const BUILTIN_STARTUP_TEAM_ID = 'builtin:startup';

/**
 * The built-in "startup company" team — the former hard-coded 5-role `team`
 * mode, now expressed as a template so it sits alongside user teams. Member
 * runtimes/agentRefs mirror the previous DEFAULT_TEAM_PROVIDERS + builtin team
 * agent keys so behavior is unchanged when this template is selected.
 */
export const BUILTIN_TEAMS: AgentTeam[] = [
  {
    id: BUILTIN_STARTUP_TEAM_ID,
    name: 'Startup company',
    icon: '🏢',
    builtin: true,
    members: [
      {
        handle: 'ceo',
        displayName: 'CEO',
        role: 'leader',
        runtime: 'claude',
        agentRef: BUILTIN_AGENT_KEYS.teamCeo,
      },
      {
        handle: 'product',
        displayName: 'Product',
        role: 'worker',
        runtime: 'claude',
        agentRef: BUILTIN_AGENT_KEYS.teamProduct,
      },
      {
        handle: 'engineering',
        displayName: 'Engineering',
        role: 'worker',
        runtime: 'codex',
        agentRef: BUILTIN_AGENT_KEYS.teamEngineering,
      },
      {
        handle: 'uiux',
        displayName: 'Design',
        role: 'worker',
        runtime: 'claude',
        agentRef: BUILTIN_AGENT_KEYS.teamUiux,
      },
      {
        handle: 'operations',
        displayName: 'Operations',
        role: 'worker',
        runtime: 'codex',
        agentRef: BUILTIN_AGENT_KEYS.teamOperations,
      },
    ],
    createdAt: '',
    updatedAt: '',
  },
];

export function isBuiltinTeamId(id: string): boolean {
  return id.startsWith('builtin:');
}

/** The leader member of a team (first leader, or the first member as a fallback). */
export function teamLeader(team: AgentTeam): AgentTeamMember | undefined {
  return team.members.find((m) => m.role === 'leader') ?? team.members[0];
}

export function teamWorkers(team: AgentTeam): AgentTeamMember[] {
  const leader = teamLeader(team);
  return team.members.filter((m) => m !== leader);
}
