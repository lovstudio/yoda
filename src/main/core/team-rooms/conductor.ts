import { randomUUID } from 'node:crypto';
import {
  buildMemberTurnPrompt,
  buildTeammateSystemPrompt,
  TEAM_SCRIPT_DIR_TOKEN,
  type RosterEntry,
} from '@shared/agent-communication-protocol';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import {
  FEATURE_WORKFLOW_ROOM_PRESET,
  featureWorkflowAllowedTargetHandles,
} from '@shared/feature-workflow';
import { makePtySessionId } from '@shared/ptySessionId';
import type { RuntimeId } from '@shared/runtime-registry';
import type { TeamCommunicationConfig } from '@shared/team-communication';
import {
  LEAD_HANDLE,
  normalizeTeamHandle,
  type MemberStatus,
  type RoomMember,
  type RoomMessage,
  type TeamRoom,
} from '@shared/team-room';
import type { RoutingHopLimit } from '@shared/team-routing-limit';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationSessionInfo } from '@main/core/conversations/getConversationSessionInfo';
import { injectPrompt } from '@main/core/conversations/inject-prompt';
import { ingestFeatureWorkflowHandoff } from '@main/core/features/feature-loop-service';
import { featureService } from '@main/core/features/feature-service';
import { resolveTask } from '@main/core/projects/utils';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ensureRoomTaskAvailable } from './ensure-room-task';
import {
  getAllRooms,
  getMemberByConversation,
  getPendingRoomMessages,
  getRoom,
  postMessage,
  retryFailedHandoff,
  setMemberConversation,
  setMemberStatus,
  setMessageDelivery,
} from './store';
import { installTeamScripts } from './team-at-script';
import { teamRoomEvents } from './team-room-events';
import { completeTeamRoomTask } from './team-room-task-status';

const STATUS_POLL_MS = 1_500;
/** Cadence of the conductor's "standup" roster summary while work is in progress. */
const STANDUP_MS = 120_000;
/** The reserved broadcast handle. */
const ALL_HANDLE = 'all';

type Session = { projectId: string; taskId: string; conversationId: string };

export type TeamRouteResult = {
  deliveredHandles: string[];
  rejectedHandles: string[];
  error: string | null;
};

function rejectedRoute(handles: string[], error: string): TeamRouteResult {
  return { deliveredHandles: [], rejectedHandles: handles, error };
}

function mapStatus(s: AgentSessionRuntimeStatus): MemberStatus {
  switch (s) {
    case 'working':
      return 'running';
    case 'awaiting-input':
      return 'awaiting-input';
    case 'error':
      return 'error';
    case 'idle':
    case 'completed':
      return 'finished';
  }
}

/**
 * Game-loop conductor for Team Rooms. Routing is NOT scraped from agent output:
 * every room message with @mentions causes the conductor to DELIVER that message
 * straight into the mentioned member's live session (continuing it with new
 * input). Agents reach teammates out-of-band via the `team-at` script, which
 * posts a room message through {@link handleTeamAt}. Member dots mirror real
 * run-state via a per-member status watcher.
 */
class RoomConductor {
  private started = false;
  private readonly hops = new Map<string, RoutingHopLimit>(); // roomId -> remaining budget; null = unlimited
  private readonly statusWatchers = new Map<string, () => void>(); // memberId -> cancel
  private readonly standups = new Map<string, () => void>(); // roomId -> stop
  private readonly activity = new Map<string, number>(); // memberId -> last PTY-growth ts
  private readonly handedOff = new Set<string>(); // memberIds that addressed someone this turn

  /** Subscribe to message posts. Idempotent. */
  initialize(): void {
    if (this.started) return;
    this.started = true;
    teamRoomEvents.on('room:message-posted', (roomId, message) => {
      void this.routeMessage(roomId, message).catch((e: unknown) => {
        log.warn('RoomConductor: routing failed', { roomId, error: String(e) });
      });
    });
  }

  /** Clear stale running dots from a previous app lifetime. */
  async resumePending(): Promise<void> {
    const rooms = await getAllRooms();
    for (const room of rooms) {
      // A main-process restart starts a fresh bounded cascade instead of making
      // every subsequent hand-off look as if the budget were already empty.
      this.hops.set(room.id, room.routingHopLimit);
      const snapshot = await getRoom(room.id);
      if (!snapshot) continue;
      for (const member of snapshot.members) {
        if (member.runtime && member.status !== 'idle' && member.status !== 'finished') {
          await setMemberStatus(room.id, member.id, 'idle', member.conversationId);
        }
      }
    }
    const pending = await getPendingRoomMessages();
    for (const message of pending) {
      await this.routeMessage(message.roomId, message);
    }
  }

  /** Persist and route a control-plane signal without adding chat noise. */
  async routeSignal(args: {
    roomId: string;
    authorMemberId: string | null;
    body: string;
    mentions: string[];
    sessionRef?: string | null;
    visibility?: 'room' | 'control';
  }): Promise<TeamRouteResult> {
    const handoff = {
      roomId: args.roomId,
      authorMemberId: args.authorMemberId,
      body: args.body,
      mentions: args.mentions,
      sessionRef: args.sessionRef ?? null,
      visibility: args.visibility ?? ('control' as const),
    };
    const message =
      (await retryFailedHandoff(handoff)) ??
      (await postMessage({ ...handoff, kind: 'handoff' }, { route: false }));
    return this.routeMessage(args.roomId, message);
  }

  async routeMessage(roomId: string, message: RoomMessage): Promise<TeamRouteResult> {
    if (message.kind === 'system' || message.deliveryStatus === 'none') {
      return { deliveredHandles: [], rejectedHandles: [], error: null };
    }
    try {
      const result = await this.onMessage(roomId, message);
      const delivered = result.deliveredHandles.length > 0 && result.rejectedHandles.length === 0;
      await setMessageDelivery(
        message.id,
        delivered ? 'delivered' : 'failed',
        delivered ? null : result.error
      );
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await setMessageDelivery(message.id, 'failed', detail).catch(() => {});
      throw error;
    }
  }

  private async onMessage(roomId: string, message: RoomMessage): Promise<TeamRouteResult> {
    const originalHandles = message.mentions.map(normalizeTeamHandle).filter(Boolean);
    if (originalHandles.length === 0) {
      return rejectedRoute([], 'No teammate was addressed.');
    }
    // System lines are display-only narration (referee transitions, standups,
    // notices). They have no author, so they must NEVER re-enter routing —
    // otherwise each one would re-trigger the referee and loop infinitely.
    if (message.kind === 'system') {
      return rejectedRoute(originalHandles, 'System messages are not routable.');
    }

    const snapshot = await getRoom(roomId);
    if (!snapshot || snapshot.room.status !== 'active') {
      return rejectedRoute(originalHandles, 'The Agent Room is not active.');
    }
    const { room, members } = snapshot;

    const author = message.authorMemberId
      ? members.find((m) => m.id === message.authorMemberId)
      : undefined;
    // A fresh human prompt (a member with no runtime) refills the cascade budget;
    // agent-authored messages spend it so a back-and-forth can't run away.
    const fromHuman = !!author && !author.runtime;
    if (fromHuman) this.hops.set(roomId, room.routingHopLimit);

    // An agent that addressed someone this turn has explicitly handed off, so its
    // turn-end must NOT also trigger the automatic hand-back to the lead.
    const wantsAll = originalHandles.includes(ALL_HANDLE);
    const isFeatureWorkflow = room.preset === FEATURE_WORKFLOW_ROOM_PRESET;
    let requestedHandles = wantsAll ? [ALL_HANDLE] : originalHandles;
    let handsToHuman = false;
    if (isFeatureWorkflow && requestedHandles.length > 0) {
      const feature = room.featureId
        ? await featureService.get(room.projectId, room.featureId)
        : null;
      if (!feature) {
        if (author?.runtime) this.handedOff.delete(author.id);
        await postMessage({
          roomId,
          kind: 'system',
          body: 'Feature routing paused — this Room is not linked to an authoritative Feature workspace.',
          mentions: [],
        });
        return rejectedRoute(requestedHandles, 'The Feature Room has no authoritative Feature.');
      }
      const allowed = new Set(featureWorkflowAllowedTargetHandles(feature, members, message));
      const rejected = requestedHandles.filter((handle) => !allowed.has(handle));
      requestedHandles = requestedHandles.filter((handle) => allowed.has(handle));
      handsToHuman = requestedHandles.includes('you');
      if (rejected.length > 0) {
        if (author?.runtime && requestedHandles.length === 0) this.handedOff.delete(author.id);
        await postMessage({
          roomId,
          kind: 'system',
          body: `Feature gate kept ${rejected.map((handle) => `@${handle}`).join(', ')} waiting. Pass the current gate or return to an unlocked stage first.`,
          mentions: [],
        });
      }
      if (requestedHandles.length > 0) {
        try {
          await ingestFeatureWorkflowHandoff({ room, feature, members, message });
        } catch (error) {
          if (author?.runtime) this.handedOff.delete(author.id);
          await postMessage({
            roomId,
            kind: 'system',
            body: `Feature evidence was rejected: ${
              error instanceof Error ? error.message : String(error)
            }`,
            mentions: [],
          });
          return rejectedRoute(requestedHandles, 'Feature evidence was rejected.');
        }
      }
    }
    const targets = members.filter(
      (member) =>
        member.runtime &&
        member.id !== message.authorMemberId &&
        ((!isFeatureWorkflow && wantsAll) || requestedHandles.includes(member.handle.toLowerCase()))
    );
    const humanTargeted = requestedHandles.includes('you') && message.visibility === 'room';
    if (targets.length === 0 && !humanTargeted) {
      if (isFeatureWorkflow && author?.runtime && !handsToHuman && message.mentions.length > 0) {
        this.handedOff.delete(author.id);
      }
      const available = members
        .filter((member) => member.runtime)
        .map((member) => `@${member.handle}`)
        .join(', ');
      return rejectedRoute(
        requestedHandles,
        `No matching teammate. Available teammates: ${available || '(none)'}.`
      );
    }

    const roster: RosterEntry[] = members.map((m) => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
    }));
    const fromName = author?.displayName ?? 'the lead';

    const deliveredHandles = humanTargeted ? ['you'] : [];
    const rejectedHandles: string[] = [];
    let deliveryError: string | null = null;
    for (const member of targets) {
      if (!this.spend(roomId)) {
        await this.pauseRouting(roomId, room.routingHopLimit);
        rejectedHandles.push(member.handle);
        deliveryError = 'The routing-step limit was reached.';
        continue;
      }
      const outcome = await this.deliverTo(
        room.projectId,
        room.taskId,
        roomId,
        member,
        roster,
        room.communication,
        {
          fromName,
          body: message.body,
          dispatchId: message.id,
        }
      );
      if (outcome.ok) deliveredHandles.push(member.handle);
      else {
        rejectedHandles.push(member.handle);
        deliveryError = outcome.error;
      }
    }
    if (humanTargeted && targets.length === 0 && author?.runtime && !isFeatureWorkflow) {
      await completeTeamRoomTask(room).catch((error: unknown) => {
        log.warn('RoomConductor: failed to complete team task', {
          roomId,
          taskId: room.taskId,
          error: String(error),
        });
      });
    }
    if (author?.runtime && deliveredHandles.length > 0) this.handedOff.add(author.id);
    return { deliveredHandles, rejectedHandles, error: deliveryError };
  }

  /** Spend one delivery from the room's cascade budget. False when exhausted. */
  private spend(roomId: string): boolean {
    const remaining = this.hops.get(roomId);
    if (remaining === null) return true;
    const budget = remaining ?? 0;
    if (budget <= 0) return false;
    this.hops.set(roomId, budget - 1);
    return true;
  }

  private async pauseRouting(roomId: string, limit: RoutingHopLimit): Promise<void> {
    const limitText = limit === null ? 'unlimited' : `${limit}`;
    await postMessage({
      roomId,
      kind: 'system',
      body: `Routing paused — hit the ${limitText} routing-step limit for this prompt. @mention a teammate to continue.`,
      mentions: [],
    });
  }

  /**
   * Deliver a message into a member's session: spawn the session on first
   * contact (with its teammate + role system prompt), otherwise inject the
   * message as new input. Returns immediately — the member works on its own; its
   * reply comes back later as its own `team-at` call.
   */
  private async deliverTo(
    projectId: string,
    taskId: string,
    roomId: string,
    member: RoomMember,
    roster: RosterEntry[],
    communication: TeamCommunicationConfig,
    incoming: { fromName: string; body: string; dispatchId: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const runtime = member.runtime as RuntimeId;
    const turnPrompt = buildMemberTurnPrompt({
      fromDisplayName: incoming.fromName,
      // Strip the leading @handle(s) — they addressed the message, they aren't
      // part of what the teammate is being asked to do.
      body: `${incoming.body
        .replace(/^(?:\s*@[a-z0-9][a-z0-9_-]*)+[ \t]*/i, '')
        .trimStart()}\n\nYoda assignment id: ${incoming.dispatchId}.`,
      communication,
    });

    const existingSessionId = member.conversationId
      ? makePtySessionId(projectId, taskId, member.conversationId)
      : null;
    const alive =
      existingSessionId !== null && ptySessionRegistry.get(existingSessionId) !== undefined;
    // Final conversation id: reuse the live one, else a fresh session.
    const conversationId = alive && member.conversationId ? member.conversationId : randomUUID();

    try {
      await ensureRoomTaskAvailable(projectId, taskId);
      // Install this member's own team-* scripts (ptyId baked in) and resolve the
      // per-member scripts dir its prompt should reference.
      const scriptsDir = await installTeamScripts(projectId, taskId, conversationId, runtime);
      const subst = (s: string) => s.split(TEAM_SCRIPT_DIR_TOKEN).join(scriptsDir);
      const turnPromptFinal = subst(turnPrompt);
      if (!alive) {
        const teammatePrompt = buildTeammateSystemPrompt({
          displayName: member.displayName,
          handle: member.handle,
          roster,
          communication,
        });
        const systemPrompt = member.systemPrompt
          ? `${teammatePrompt}\n\n${member.systemPrompt}`
          : teammatePrompt;
        await createConversation({
          id: conversationId,
          projectId,
          taskId,
          runtime,
          title: member.displayName,
          autoApprove: member.permissionMode === 'inherit' ? undefined : member.autoApprove,
          permissionMode:
            member.permissionMode && member.permissionMode !== 'inherit'
              ? member.permissionMode
              : undefined,
          model: member.model,
          reasoningEffort: member.reasoningEffort,
          skillSelection: member.skillSelection ?? undefined,
          initialPrompt: subst(`${systemPrompt}\n\n${turnPrompt}`),
        });
        await setMemberConversation(member.id, conversationId);
        events.emit(teamRoomUpdatedChannel, { roomId }, roomId);
      } else if (existingSessionId) {
        const ok = await injectPrompt(
          existingSessionId,
          { projectId, taskId, conversationId },
          runtime,
          turnPromptFinal
        );
        if (!ok) {
          await setMemberStatus(roomId, member.id, 'idle', conversationId);
          return { ok: false, error: `${member.displayName}'s session rejected the assignment.` };
        }
      }

      // New turn: clear any prior hand-off mark so this turn's end is judged fresh.
      this.handedOff.delete(member.id);
      await setMemberStatus(roomId, member.id, 'running', conversationId);
      this.watchStatus(roomId, member, { projectId, taskId, conversationId });
      this.ensureStandup(roomId);
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await setMemberStatus(roomId, member.id, 'error', member.conversationId).catch(() => {});
      return { ok: false, error: detail };
    }
  }

  /**
   * Mirror a member's roster dot to its run-state, and on a clean turn-end fire
   * {@link onTurnEnd} so the lead can drive the next step. The stop hook is the
   * turn-end signal (it surfaces as a terminal run-state); routing itself stays
   * agent-driven.
   */
  private watchStatus(roomId: string, member: RoomMember, session: Session): void {
    this.statusWatchers.get(member.id)?.();
    const sessionId = makePtySessionId(session.projectId, session.taskId, session.conversationId);
    let sawRunning = false;
    let last: MemberStatus | null = null;
    let lastLen = ptySessionRegistry.snapshot(sessionId).length;

    const timer = setInterval(() => {
      const snapshot = ptySessionRegistry.snapshot(sessionId);
      // Heartbeat: output growth means the member is alive and making progress.
      if (snapshot.length > lastLen) {
        lastLen = snapshot.length;
        this.activity.set(member.id, Date.now());
      }

      const raw = agentSessionRuntimeStore.getStatus(session);
      if (raw === 'working' || raw === 'awaiting-input') sawRunning = true;
      const clean = raw === 'idle' || raw === 'completed';
      const errored = raw === 'error';

      const mapped = mapStatus(raw);
      if (mapped !== last) {
        last = mapped;
        void setMemberStatus(roomId, member.id, mapped, session.conversationId).catch(() => {});
      }

      // Only trust a turn-end once the member has actually started (avoid an early
      // idle before the agent boots).
      if (sawRunning && (clean || errored)) {
        stop();
        if (clean) void this.onTurnEnd(roomId, member).catch(() => {});
      }
    }, STATUS_POLL_MS);

    const stop = () => {
      clearInterval(timer);
      this.statusWatchers.delete(member.id);
    };
    this.statusWatchers.set(member.id, stop);
  }

  /**
   * A member's turn ended. If it already addressed someone (delegated or reported),
   * routing has happened — do nothing. Otherwise hand control back to the lead so
   * it can decide the next step; if the lead itself ended without delegating, the
   * task is done and control returns to the human.
   */
  private async onTurnEnd(roomId: string, finished: RoomMember): Promise<void> {
    if (this.handedOff.has(finished.id)) return;
    const snapshot = await getRoom(roomId);
    if (!snapshot || snapshot.room.status !== 'active') return;
    const { room, members } = snapshot;
    const leader = members.find((m) => m.role === 'leader' && m.runtime);
    const leaderEnded = leader?.id === finished.id;

    if (!leader || finished.id === leader.id) {
      let taskCompleted = false;
      if (leaderEnded) {
        taskCompleted = await completeTeamRoomTask(room).catch((error: unknown) => {
          log.warn('RoomConductor: failed to complete team task', {
            roomId,
            taskId: room.taskId,
            error: String(error),
          });
          return false;
        });
      }
      if (room.communication.syncToRoom) {
        await postMessage({
          roomId,
          kind: 'system',
          body: taskCompleted
            ? `${finished.displayName} completed the team task — over to you.`
            : `${finished.displayName} ended its turn — over to you. @mention a teammate to continue.`,
          mentions: [],
        });
      }
      return;
    }

    const artifact = await this.describeTurnArtifact(room, finished);
    await this.routeSignal({
      roomId,
      authorMemberId: finished.id,
      mentions: [leader.handle],
      sessionRef: finished.conversationId,
      body: `${finished.displayName} (@${finished.handle}) finished its turn. Inspect ${artifact} and decide the next step.`,
    });
  }

  private async describeTurnArtifact(room: TeamRoom, member: RoomMember): Promise<string> {
    if (room.communication.mode === 'shared-file') {
      return `the shared hand-off file at ${room.communication.sharedFilePath}`;
    }
    if (room.communication.mode === 'github') {
      const refs = [
        room.communication.githubIssueNumber
          ? `Issue #${room.communication.githubIssueNumber}`
          : null,
        room.communication.githubPullRequestNumber
          ? `pull request #${room.communication.githubPullRequestNumber}`
          : null,
      ].filter((value): value is string => Boolean(value));
      return refs.length > 0 ? refs.join(' and ') : 'the configured GitHub repository';
    }
    if (room.communication.mode !== 'process' || !member.conversationId) {
      return 'the teammate session';
    }
    const taskPath = resolveTask(room.projectId, room.taskId)?.conversations.taskPath;
    const session = await getConversationSessionInfo(
      room.projectId,
      room.taskId,
      member.conversationId,
      taskPath
    ).catch(() => null);
    return session?.transcriptPath
      ? `the teammate transcript at ${session.transcriptPath}`
      : 'the teammate session';
  }

  /**
   * Periodic "standup": while any agent in the room is running, post a concise
   * roster summary (with each running member's last-activity age) so the lead can
   * see progress at a glance — like a team checking in. Conductor-driven and
   * display-only: it spends no agent tokens and never interrupts a working agent.
   * Agents can also post their own richer updates via the `team-status` script.
   */
  private ensureStandup(roomId: string): void {
    if (this.standups.has(roomId)) return;
    let last = '';
    const tick = async (): Promise<void> => {
      const snapshot = await getRoom(roomId);
      if (!snapshot || snapshot.room.status !== 'active') return stop();
      if (!snapshot.room.communication.syncToRoom) return stop();
      const agents = snapshot.members.filter((m) => m.runtime);
      const anyRunning = agents.some(
        (m) => m.status === 'running' || m.status === 'awaiting-input'
      );
      if (!anyRunning) return stop(); // quiet — restarts on the next delivery
      const now = Date.now();
      const line = agents
        .map((m) => {
          if (m.status === 'running') {
            const at = this.activity.get(m.id);
            const age = at ? `, active ${Math.round((now - at) / 1000)}s ago` : '';
            return `${m.displayName}: working${age}`;
          }
          return `${m.displayName}: ${m.status}`;
        })
        .join(' · ');
      if (line === last) return;
      last = line;
      await postMessage({ roomId, kind: 'system', body: `Standup — ${line}`, mentions: [] });
    };
    const timer = setInterval(() => {
      void tick().catch(() => {});
    }, STANDUP_MS);
    const stop = () => {
      clearInterval(timer);
      this.standups.delete(roomId);
    };
    this.standups.set(roomId, stop);
  }
}

export const roomConductor = new RoomConductor();

/**
 * Called when a member's session runs the `team-at` script: post the message as
 * that member, addressed to the given handles (or 'all'). The room-message hook
 * then delivers it into the targets' sessions via the conductor.
 */
export async function handleTeamAt(
  conversationId: string,
  to: string[] | 'all',
  message: string
): Promise<TeamRouteResult> {
  const found = await getMemberByConversation(conversationId);
  if (!found) {
    log.warn('handleTeamAt: no room member for conversation', { conversationId });
    return rejectedRoute([], 'The calling session is not attached to an active Agent Room.');
  }
  const mentions =
    to === 'all' ? [ALL_HANDLE] : [...new Set(to.map(normalizeTeamHandle).filter(Boolean))];
  const snapshot = await getRoom(found.roomId);
  if (!snapshot) return rejectedRoute(mentions, 'The Agent Room no longer exists.');
  const visibility =
    snapshot.room.communication.syncToRoom || mentions.includes(LEAD_HANDLE) ? 'room' : 'control';
  return roomConductor.routeSignal({
    roomId: found.roomId,
    authorMemberId: found.member.id,
    body: message.trim() || '(no message)',
    mentions,
    sessionRef: found.member.conversationId,
    visibility,
  });
}

/**
 * Called when a member runs the `team-status` script: post its progress update
 * as a display-only room message (no @mentions → the conductor never routes it),
 * so a member can check in mid-turn without handing off.
 */
export async function handleTeamStatus(conversationId: string, message: string): Promise<void> {
  const found = await getMemberByConversation(conversationId);
  if (!found) {
    log.warn('handleTeamStatus: no room member for conversation', { conversationId });
    return;
  }
  const snapshot = await getRoom(found.roomId);
  if (!snapshot?.room.communication.syncToRoom) return;
  await postMessage({
    roomId: found.roomId,
    authorMemberId: found.member.id,
    kind: 'text',
    body: message.trim(),
    mentions: [],
    sessionRef: found.member.conversationId,
  });
}
