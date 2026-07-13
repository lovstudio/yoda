import { randomUUID } from 'node:crypto';
import {
  buildMemberTurnPrompt,
  buildTeammateSystemPrompt,
  TEAM_SCRIPT_DIR_TOKEN,
  type RosterEntry,
} from '@shared/agent-communication-protocol';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type { RuntimeId } from '@shared/runtime-registry';
import type { MemberStatus, RoomMember, RoomMessage } from '@shared/team-room';
import type { RoutingHopLimit } from '@shared/team-routing-limit';
import { agentSessionRuntimeStore } from '@main/core/conversations/agent-session-runtime';
import { createConversation } from '@main/core/conversations/createConversation';
import { injectPrompt } from '@main/core/conversations/inject-prompt';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  getAllRooms,
  getMemberByConversation,
  getRoom,
  postMessage,
  setMemberConversation,
  setMemberStatus,
} from './store';
import { installTeamScripts } from './team-at-script';
import { teamRoomEvents } from './team-room-events';

const STATUS_POLL_MS = 1_500;
/** Cadence of the conductor's "standup" roster summary while work is in progress. */
const STANDUP_MS = 120_000;
/** The reserved broadcast handle. */
const ALL_HANDLE = 'all';

type Session = { projectId: string; taskId: string; conversationId: string };

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
      void this.onMessage(roomId, message).catch((e: unknown) => {
        log.warn('RoomConductor: routing failed', { roomId, error: String(e) });
      });
    });
  }

  /** Clear stale running dots from a previous app lifetime. */
  async resumePending(): Promise<void> {
    const rooms = await getAllRooms();
    for (const room of rooms) {
      const snapshot = await getRoom(room.id);
      if (!snapshot) continue;
      for (const member of snapshot.members) {
        if (member.runtime && member.status !== 'idle' && member.status !== 'finished') {
          await setMemberStatus(room.id, member.id, 'idle', member.conversationId);
        }
      }
    }
  }

  private async onMessage(roomId: string, message: RoomMessage): Promise<void> {
    // System lines are display-only narration (referee transitions, standups,
    // notices). They have no author, so they must NEVER re-enter routing —
    // otherwise each one would re-trigger the referee and loop infinitely.
    if (message.kind === 'system') return;

    const snapshot = await getRoom(roomId);
    if (!snapshot || snapshot.room.status !== 'active') return;
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
    if (author?.runtime && message.mentions.length > 0) this.handedOff.add(author.id);

    const wantsAll = message.mentions.includes(ALL_HANDLE);
    const targets = members.filter(
      (m) =>
        m.runtime &&
        m.id !== message.authorMemberId &&
        (wantsAll || message.mentions.includes(m.handle.toLowerCase()))
    );
    if (targets.length === 0) return;

    const roster: RosterEntry[] = members.map((m) => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
    }));
    const fromName = author?.displayName ?? 'the lead';

    for (const member of targets) {
      if (!this.spend(roomId)) return this.pauseRouting(roomId, room.routingHopLimit);
      await this.deliverTo(room.projectId, room.taskId, roomId, member, roster, {
        fromName,
        body: message.body,
      });
    }
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
    incoming: { fromName: string; body: string }
  ): Promise<void> {
    const runtime = member.runtime as RuntimeId;
    const turnPrompt = buildMemberTurnPrompt({
      fromDisplayName: incoming.fromName,
      // Strip the leading @handle(s) — they addressed the message, they aren't
      // part of what the teammate is being asked to do.
      body: incoming.body.replace(/^(?:\s*@[a-z0-9][a-z0-9_-]*)+[ \t]*/i, '').trimStart(),
    });

    const existingSessionId = member.conversationId
      ? makePtySessionId(projectId, taskId, member.conversationId)
      : null;
    const alive =
      existingSessionId !== null && ptySessionRegistry.get(existingSessionId) !== undefined;
    // Final conversation id: reuse the live one, else a fresh session.
    const conversationId = alive && member.conversationId ? member.conversationId : randomUUID();

    try {
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
          autoApprove: member.autoApprove,
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
          return;
        }
      }

      // New turn: clear any prior hand-off mark so this turn's end is judged fresh.
      this.handedOff.delete(member.id);
      await setMemberStatus(roomId, member.id, 'running', conversationId);
      this.watchStatus(roomId, member, { projectId, taskId, conversationId });
      this.ensureStandup(roomId);
    } catch (error) {
      await setMemberStatus(roomId, member.id, 'error', member.conversationId).catch(() => {});
      await postMessage({
        roomId,
        kind: 'system',
        body: `${member.displayName} couldn't start: ${
          error instanceof Error ? error.message : String(error)
        }`,
        mentions: [],
      }).catch(() => {});
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

    if (!leader || finished.id === leader.id) {
      await postMessage({
        roomId,
        kind: 'system',
        body: `${finished.displayName} ended its turn — over to you. @mention a teammate to continue.`,
        mentions: [],
      });
      return;
    }

    if (!this.spend(roomId)) return this.pauseRouting(roomId, room.routingHopLimit);
    const roster: RosterEntry[] = members.map((m) => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
    }));
    await this.deliverTo(room.projectId, room.taskId, roomId, leader, roster, {
      fromName: finished.displayName,
      body: `${finished.displayName} (@${finished.handle}) finished its turn without reporting back. Decide the next step.`,
    });
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
): Promise<void> {
  const found = await getMemberByConversation(conversationId);
  if (!found) {
    log.warn('handleTeamAt: no room member for conversation', { conversationId });
    return;
  }
  const mentions = to === 'all' ? [ALL_HANDLE] : to.map((h) => h.toLowerCase()).filter(Boolean);
  await postMessage({
    roomId: found.roomId,
    authorMemberId: found.member.id,
    kind: 'handoff',
    body: message.trim() || '(no message)',
    mentions,
    sessionRef: found.member.conversationId,
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
  await postMessage({
    roomId: found.roomId,
    authorMemberId: found.member.id,
    kind: 'text',
    body: message.trim(),
    mentions: [],
    sessionRef: found.member.conversationId,
  });
}
