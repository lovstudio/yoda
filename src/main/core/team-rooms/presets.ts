import { TEAM_AT_SCRIPT } from '@shared/agent-communication-protocol';
import {
  teamLeader,
  teamWorkers,
  type AgentTeam,
  type AgentTeamMember,
  type TeamRouting,
} from '@shared/agent-team';
import { DEFAULT_AGENT_ICON } from '@shared/agents';
import { FEATURE_WORKFLOW_ROOM_PRESET, hasFeatureWorkflowContract } from '@shared/feature-workflow';
import type { RuntimeId } from '@shared/runtime-registry';
import type { SkillSelectionInput } from '@shared/skills/types';
import type { MemberAccent } from '@shared/team-room';
import type { RoutingHopLimit } from '@shared/team-routing-limit';
import { agentTeamsService } from '@main/core/agent-teams/agent-teams-service';
import { agentsConfigService } from '@main/core/agents-config/agents-config-service';
import { addMember, createRoom, postMessage } from './store';

/**
 * Room presets seed a room's members + initial routing. A preset is just a set
 * of members whose role system prompts encode the collaboration via @mentions —
 * the conductor stays generic. `review-loop` is the first one (implement ↔
 * review until the reviewer signs off).
 */

const IMPLEMENTER_ROLE_PROMPT = [
  `You are the implementer. Build what the lead asks for in this worktree.`,
  `When your implementation round is complete, hand off to @reviewer in your team message`,
  `(e.g. "@reviewer ready for review"). When the reviewer sends back fixes, address them and`,
  `hand back to @reviewer again. Keep the existing direction unless a fix requires otherwise.`,
].join('\n');

const REVIEWER_ROLE_PROMPT = [
  `You are the reviewer. Do not modify files — only inspect the worktree against the lead's`,
  `original requirement. In your team message: if it's not done, give @implementer the concrete`,
  `fixes and hand back to them; if it fully meets the requirement, say so and hand off to @you`,
  `(the lead) with a one-line PASS summary.`,
].join('\n');

export type SeedReviewRoomParams = {
  projectId: string;
  taskId: string;
  name: string;
  /** The lead's opening ask; posted as "@implementer <requirement>" to kick the loop. */
  requirement: string;
  implementer: {
    runtime: RuntimeId;
    systemPrompt?: string;
    skillSelection?: SkillSelectionInput;
    autoApprove?: boolean;
  };
  reviewer: {
    runtime: RuntimeId;
    systemPrompt?: string;
    skillSelection?: SkillSelectionInput;
    autoApprove?: boolean;
  };
  routingHopLimit?: RoutingHopLimit;
};

/** Create a review-loop room (lead + implementer + reviewer) and kick it off. */
export async function seedReviewRoom(params: SeedReviewRoomParams): Promise<string> {
  const room = await createRoom({
    projectId: params.projectId,
    taskId: params.taskId,
    name: params.name,
    preset: 'freeform',
    routingHopLimit: params.routingHopLimit,
  });

  const lead = await addMember({
    roomId: room.id,
    handle: 'you',
    displayName: 'You',
    role: 'lead',
    runtime: null,
    accent: 'terra',
  });
  await addMember({
    roomId: room.id,
    handle: 'implementer',
    displayName: 'Implementer',
    role: 'implementer',
    runtime: params.implementer.runtime,
    systemPrompt: joinRolePrompt(IMPLEMENTER_ROLE_PROMPT, params.implementer.systemPrompt),
    skillSelection: params.implementer.skillSelection,
    autoApprove: params.implementer.autoApprove ?? false,
    accent: 'amber',
  });
  await addMember({
    roomId: room.id,
    handle: 'reviewer',
    displayName: 'Reviewer',
    role: 'reviewer',
    runtime: params.reviewer.runtime,
    systemPrompt: joinRolePrompt(REVIEWER_ROLE_PROMPT, params.reviewer.systemPrompt),
    skillSelection: params.reviewer.skillSelection,
    autoApprove: params.reviewer.autoApprove ?? false,
    accent: 'teal',
  });

  // Lead's opening message routes the first turn to the implementer.
  await postMessage({
    roomId: room.id,
    authorMemberId: lead.id,
    kind: 'text',
    body: `@implementer ${params.requirement}`,
  });

  return room.id;
}

function joinRolePrompt(base: string, extra?: string): string {
  return extra && extra.trim() ? `${base}\n\n${extra.trim()}` : base;
}

// ── Generic: instantiate a room from a decoupled Agent Team template ──────────

const TEAM_ACCENTS: MemberAccent[] = ['amber', 'teal', 'violet', 'slate'];

type MemberSeedProfile = {
  systemPrompt: string;
  icon: string;
  skillSelection: SkillSelectionInput | null;
};

/** Resolve a team member's base profile from its agentRef or inline text. */
async function resolveMemberSeedProfile(member: AgentTeamMember): Promise<MemberSeedProfile> {
  if (member.agentRef) {
    const agent = member.agentRef.startsWith('builtin:')
      ? await agentsConfigService.getBySlug(member.agentRef)
      : await agentsConfigService.get(member.agentRef);
    if (agent) {
      return {
        systemPrompt: agent.systemPrompt,
        icon: agent.icon,
        skillSelection: {
          autoSkillKeys: agent.enabledSkillIds,
          manualSkillKeys: agent.manualSkillIds,
        },
      };
    }
  }
  return {
    systemPrompt: member.systemPrompt ?? '',
    icon: member.icon ?? DEFAULT_AGENT_ICON,
    skillSelection: null,
  };
}

/**
 * Generic leader/worker routing mechanics, the same for every team. The leader
 * (referee) orchestrates via team-at; workers do their part and report back. The
 * team's actual workflow (review loop, fan-out, …) lives in the leader Agent's
 * own system prompt — the engine just relays @-messages and, when a teammate's
 * turn ends, hands control back to the leader. So the only mechanics a member
 * needs are: how to delegate (leader) / how to report (worker).
 */
function routingAddendum(
  routing: TeamRouting,
  kind: 'leader' | 'worker',
  ctx: { leaderHandle: string; workerHandles: string[] }
): string {
  if (kind === 'leader') {
    const roster = ctx.workerHandles.length
      ? ctx.workerHandles.map((h) => `@${h}`).join(', ')
      : '(no teammates yet)';
    const sequencing =
      routing === 'sequential'
        ? [
            `This is a staged hand-off: assign only one teammate at a time, wait for its evidence,`,
            `and verify the current gate before advancing. If a later gate fails, route the concrete`,
            `fix back to the responsible earlier teammate and re-run every affected gate.`,
          ]
        : [];
    return [
      `# How you run the team`,
      `You are the lead — you direct the work, you do NOT do it yourself. Your teammates: ${roster}.`,
      ...sequencing,
      `Delegate one step at a time by addressing a teammate:`,
      `  ${TEAM_AT_SCRIPT} <handle> "<the concrete task for them>"`,
      `Each teammate works in this shared worktree and reports back to you when their turn ends — so after`,
      `every report, decide the next step (re-assign, bring in another teammate, or finish).`,
      `When the whole task is complete, end it by telling the human lead:`,
      `  ${TEAM_AT_SCRIPT} you "<one-line summary of what the team delivered>"`,
    ].join('\n');
  }
  return [
    `# How you work`,
    `The lead (@${ctx.leaderHandle}) assigns you a task. Do exactly your part in this shared worktree, then`,
    `report the result back to the lead so they can decide what's next:`,
    `  ${TEAM_AT_SCRIPT} ${ctx.leaderHandle} "<your result, verdict, or what you changed>"`,
    `Address only the lead — they coordinate the team.`,
  ].join('\n');
}

/**
 * Instantiate a chat room from an Agent Team template: a lead (human) + each
 * member, with routing-aware role prompts, then kick off by @mentioning the
 * leader. The conductor drives the iterative @-routing from there.
 */
export async function seedRoomFromTeam(args: {
  team: AgentTeam;
  projectId: string;
  taskId: string;
  requirement: string;
}): Promise<string> {
  const { team } = args;
  const leader = teamLeader(team);
  if (!leader) throw new Error('Team has no members.');
  const workers = teamWorkers(team);
  const isFeatureWorkflow = hasFeatureWorkflowContract(team);
  const requirement = args.requirement.trim();
  if (isFeatureWorkflow && !requirement) {
    throw new Error('Feature workflow requires a non-empty problem brief.');
  }

  const room = await createRoom({
    projectId: args.projectId,
    taskId: args.taskId,
    name: team.name,
    // Feature teams keep their gate-aware room behavior when duplicated for
    // editing; other teams continue to use the generic freeform conductor.
    preset: isFeatureWorkflow ? FEATURE_WORKFLOW_ROOM_PRESET : 'freeform',
    routingHopLimit: team.routingHopLimit,
  });

  const lead = await addMember({
    roomId: room.id,
    handle: 'you',
    displayName: 'You',
    role: 'lead',
    runtime: null,
    accent: 'terra',
  });

  // Persist the Feature brief before member sessions are provisioned. If a
  // later seed step fails, the created room still retains the user's original
  // contract instead of forcing them to reconstruct it from memory.
  if (isFeatureWorkflow) {
    await postMessage({
      roomId: room.id,
      kind: 'system',
      body: `Feature brief — ${requirement}`,
      mentions: [],
    });
  }

  // Assign unique handles (reserve 'you' for the lead).
  const used = new Set<string>(['you']);
  const ordered = [leader, ...workers];
  const handles = ordered.map((m, i) => {
    let h = m.handle.toLowerCase().replace(/[^a-z0-9_-]/g, '') || `member-${i + 1}`;
    while (used.has(h)) h = `${h}-${i + 1}`;
    used.add(h);
    return h;
  });
  const leaderHandle = handles[0];
  const workerHandles = handles.slice(1);

  for (let i = 0; i < ordered.length; i++) {
    const member = ordered[i];
    const isLeader = i === 0;
    const base = await resolveMemberSeedProfile(member);
    // Feature members already carry a stricter marker-aware protocol. Appending
    // the generic examples would put conflicting, marker-free instructions at
    // the end of their prompts and could stall the gate reducer.
    const addendum = isFeatureWorkflow
      ? undefined
      : routingAddendum(team.routing, isLeader ? 'leader' : 'worker', {
          leaderHandle,
          workerHandles,
        });
    await addMember({
      roomId: room.id,
      handle: handles[i],
      displayName: member.displayName,
      icon: base.icon,
      role: isLeader ? 'leader' : 'worker',
      runtime: member.runtime,
      systemPrompt: joinRolePrompt(base.systemPrompt, addendum),
      skillSelection: base.skillSelection,
      accent: TEAM_ACCENTS[i % TEAM_ACCENTS.length],
    });
  }

  // Every team kicks off the same way: address the requirement to the leader (the
  // member who receives the problem). The leader's prompt drives every hand-off
  // from there.
  await postMessage({
    roomId: room.id,
    authorMemberId: lead.id,
    kind: 'text',
    body: `@${leaderHandle} ${requirement}`,
  });

  return room.id;
}

export type CreateRoomFromTeamParams = {
  projectId: string;
  taskId: string;
  teamId: string;
  requirement: string;
};

/** Resolve a team template by id, then instantiate a room from it. */
export async function createRoomFromTeam(params: CreateRoomFromTeamParams): Promise<string> {
  const team = await agentTeamsService.get(params.teamId);
  if (!team) throw new Error(`Team ${params.teamId} not found`);
  return seedRoomFromTeam({
    team,
    projectId: params.projectId,
    taskId: params.taskId,
    requirement: params.requirement,
  });
}

const ACCENT_CYCLE = ['amber', 'teal', 'violet', 'slate'] as const;

export type FreeformMemberSeed = {
  handle: string;
  displayName: string;
  icon?: string;
  runtime: RuntimeId;
  systemPrompt?: string;
  autoApprove?: boolean;
};

export type SeedFreeformRoomParams = {
  projectId: string;
  taskId: string;
  name: string;
  members: FreeformMemberSeed[];
  routingHopLimit?: RoutingHopLimit;
};

/** Create a freeform room: a lead + the chosen agent members, no auto-routing. */
export async function seedFreeformRoom(params: SeedFreeformRoomParams): Promise<string> {
  const room = await createRoom({
    projectId: params.projectId,
    taskId: params.taskId,
    name: params.name,
    preset: 'freeform',
    routingHopLimit: params.routingHopLimit,
  });
  await addMember({
    roomId: room.id,
    handle: 'you',
    displayName: 'You',
    role: 'lead',
    runtime: null,
    accent: 'terra',
  });
  // Dedupe handles so mention routing stays unambiguous within the room.
  const seen = new Set<string>(['you']);
  let i = 0;
  for (const m of params.members) {
    let handle = m.handle;
    while (seen.has(handle)) handle = `${m.handle}-${++i}`;
    seen.add(handle);
    await addMember({
      roomId: room.id,
      handle,
      displayName: m.displayName,
      icon: m.icon,
      role: 'member',
      runtime: m.runtime,
      systemPrompt: m.systemPrompt ?? '',
      autoApprove: m.autoApprove ?? false,
      accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
    });
  }
  return room.id;
}
