import { BUILTIN_AGENT_KEYS } from './builtin-agents';
import {
  BUILTIN_FEATURE_TEAM_ID,
  FEATURE_DOCS_PROMPT,
  FEATURE_ENGINEERING_PROMPT,
  FEATURE_LAUNCH_DOCS_PROMPT,
  FEATURE_LEAD_PROMPT,
  FEATURE_PRODUCT_DESIGN_PROMPT,
  FEATURE_QUALITY_PROMPT,
} from './feature-workflow';
import type { RuntimeId } from './runtime-registry';
import { DEFAULT_ROUTING_HOP_LIMIT, type RoutingHopLimit } from './team-routing-limit';

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
export type TeamRouting = 'review-loop' | 'fan-out' | 'sequential' | 'freeform';

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
  /** Code-defined built-ins are not editable/deletable. */
  builtin: boolean;
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
  routingHopLimit: RoutingHopLimit;
  members: AgentTeamMember[];
}

export const BUILTIN_STARTUP_TEAM_ID = 'builtin:startup';
export const BUILTIN_REVIEW_TEAM_ID = 'builtin:review';
export { BUILTIN_FEATURE_TEAM_ID } from './feature-workflow';

/**
 * The built-in "startup company" team — the former hard-coded 5-role `team`
 * mode, now expressed as a template so it sits alongside user teams. Member
 * runtimes/agentRefs mirror the previous DEFAULT_TEAM_PROVIDERS + builtin team
 * agent keys so behavior is unchanged when this template is selected.
 */
export const BUILTIN_TEAMS: AgentTeam[] = [
  {
    id: BUILTIN_FEATURE_TEAM_ID,
    name: 'Feature',
    icon: '🧭',
    routing: 'sequential',
    builtin: true,
    routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
    members: [
      {
        handle: 'orchestrator',
        displayName: 'Feature Lead',
        icon: '🧭',
        role: 'leader',
        runtime: 'claude',
        systemPrompt: FEATURE_LEAD_PROMPT,
      },
      {
        handle: 'product-design',
        displayName: 'Product Design',
        icon: '✦',
        role: 'worker',
        runtime: 'claude',
        systemPrompt: FEATURE_PRODUCT_DESIGN_PROMPT,
      },
      {
        handle: 'engineering',
        displayName: 'Engineering',
        icon: '⌘',
        role: 'worker',
        runtime: 'codex',
        systemPrompt: FEATURE_ENGINEERING_PROMPT,
      },
      {
        handle: 'quality',
        displayName: 'Quality',
        icon: '✓',
        role: 'worker',
        runtime: 'codex',
        systemPrompt: FEATURE_QUALITY_PROMPT,
      },
      {
        handle: 'feature-docs',
        displayName: 'Feature Docs',
        icon: '▤',
        role: 'worker',
        runtime: 'claude',
        systemPrompt: FEATURE_DOCS_PROMPT,
      },
      {
        handle: 'launch-docs',
        displayName: 'PR & SEO',
        icon: '↗',
        role: 'worker',
        runtime: 'codex',
        systemPrompt: FEATURE_LAUNCH_DOCS_PROMPT,
      },
    ],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: BUILTIN_STARTUP_TEAM_ID,
    name: 'Startup',
    icon: '🏢',
    routing: 'fan-out',
    builtin: true,
    routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
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
  {
    id: BUILTIN_REVIEW_TEAM_ID,
    name: 'Review',
    icon: '🔍',
    routing: 'review-loop',
    builtin: true,
    routingHopLimit: DEFAULT_ROUTING_HOP_LIMIT,
    members: [
      {
        handle: 'referee',
        displayName: 'Referee',
        role: 'leader',
        runtime: 'claude',
        agentRef: BUILTIN_AGENT_KEYS.reviewReferee,
      },
      {
        handle: 'implementer',
        displayName: 'Implementer',
        role: 'worker',
        runtime: 'claude',
        agentRef: BUILTIN_AGENT_KEYS.reviewImplementer,
      },
      {
        handle: 'reviewer',
        displayName: 'Reviewer',
        role: 'worker',
        runtime: 'codex',
        agentRef: BUILTIN_AGENT_KEYS.reviewReviewer,
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
