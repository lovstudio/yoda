import {
  teamLeader,
  teamWorkers,
  type AgentTeam,
  type AgentTeamMember,
  type TeamRouting,
} from '@shared/agent-team';
import type { RuntimeId } from '@shared/runtime-registry';
import { TEAM_AT_SCRIPT } from '@shared/team-protocol';
import type { MemberAccent } from '@shared/team-room';
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
  implementer: { runtime: RuntimeId; systemPrompt?: string; autoApprove?: boolean };
  reviewer: { runtime: RuntimeId; systemPrompt?: string; autoApprove?: boolean };
};

/** Create a review-loop room (lead + implementer + reviewer) and kick it off. */
export async function seedReviewRoom(params: SeedReviewRoomParams): Promise<string> {
  const room = await createRoom({
    projectId: params.projectId,
    taskId: params.taskId,
    name: params.name,
    preset: 'review-loop',
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

/** Resolve a team member's base system prompt from its agentRef or inline text. */
async function resolveMemberSystemPrompt(member: AgentTeamMember): Promise<string> {
  if (member.agentRef) {
    const agent = member.agentRef.startsWith('builtin:')
      ? await agentsConfigService.getBySlug(member.agentRef)
      : await agentsConfigService.get(member.agentRef);
    if (agent?.systemPrompt) return agent.systemPrompt;
  }
  return member.systemPrompt ?? '';
}

/** Role-specific routing addendum, expressed via the team-at script (no @ in output). */
function routingAddendum(
  routing: TeamRouting,
  kind: 'leader' | 'worker',
  ctx: { leaderHandle: string; workerHandles: string[] }
): string {
  const reviewer = ctx.workerHandles[0] ?? 'you';
  if (routing === 'review-loop') {
    return kind === 'leader'
      ? [
          `# Your routing`,
          `When your implementation round is complete, request review:`,
          `  ${TEAM_AT_SCRIPT} ${reviewer} "<short summary of what you changed>"`,
          `When the reviewer sends back fixes, address them and hand back the same way for another round.`,
        ].join('\n')
      : [
          `# Your routing`,
          `Review the implementer's work against the lead's original requirement — do NOT modify files.`,
          `- If there are issues: ${TEAM_AT_SCRIPT} ${ctx.leaderHandle} "<concrete fixes to make>"`,
          `- If it fully meets the requirement: ${TEAM_AT_SCRIPT} you "PASS — <one-line summary>"`,
        ].join('\n');
  }
  if (routing === 'fan-out') {
    return kind === 'leader'
      ? ctx.workerHandles.length
        ? [
            `# Your routing`,
            `Plan the work, then assign each teammate their part — one call each:`,
            ...ctx.workerHandles.map((h) => `  ${TEAM_AT_SCRIPT} ${h} "<their part>"`),
          ].join('\n')
        : `When done, run: ${TEAM_AT_SCRIPT} you "<summary>"`
      : `Do your part based on the lead's plan, then run: ${TEAM_AT_SCRIPT} you "<summary>"`;
  }
  return ''; // freeform — the generic teammate etiquette already explains team-at
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

  const room = await createRoom({
    projectId: args.projectId,
    taskId: args.taskId,
    name: team.name,
    preset: team.routing === 'review-loop' ? 'review-loop' : 'freeform',
  });

  const lead = await addMember({
    roomId: room.id,
    handle: 'you',
    displayName: 'You',
    role: 'lead',
    runtime: null,
    accent: 'terra',
  });

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
    const base = await resolveMemberSystemPrompt(member);
    const addendum = routingAddendum(team.routing, isLeader ? 'leader' : 'worker', {
      leaderHandle,
      workerHandles,
    });
    await addMember({
      roomId: room.id,
      handle: handles[i],
      displayName: member.displayName,
      role: isLeader ? 'leader' : 'worker',
      runtime: member.runtime,
      systemPrompt: joinRolePrompt(base, addendum),
      accent: TEAM_ACCENTS[i % TEAM_ACCENTS.length],
    });
  }

  await postMessage({
    roomId: room.id,
    authorMemberId: lead.id,
    kind: 'text',
    body: `@${leaderHandle} ${args.requirement}`,
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
  runtime: RuntimeId;
  systemPrompt?: string;
  autoApprove?: boolean;
};

export type SeedFreeformRoomParams = {
  projectId: string;
  taskId: string;
  name: string;
  members: FreeformMemberSeed[];
};

/** Create a freeform room: a lead + the chosen agent members, no auto-routing. */
export async function seedFreeformRoom(params: SeedFreeformRoomParams): Promise<string> {
  const room = await createRoom({
    projectId: params.projectId,
    taskId: params.taskId,
    name: params.name,
    preset: 'freeform',
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
      role: 'member',
      runtime: m.runtime,
      systemPrompt: m.systemPrompt ?? '',
      autoApprove: m.autoApprove ?? false,
      accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
    });
  }
  return room.id;
}
