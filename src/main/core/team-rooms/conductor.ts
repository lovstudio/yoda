import { randomUUID } from 'node:crypto';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type { RuntimeId } from '@shared/runtime-registry';
import {
  buildMemberTurnPrompt,
  buildTeammateSystemPrompt,
  type RosterEntry,
} from '@shared/team-protocol';
import type { MemberStatus, RoomMember, RoomMessage } from '@shared/team-room';
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
import { installTeamAtScript } from './team-at-script';
import { teamRoomEvents } from './team-room-events';

const STATUS_POLL_MS = 1_500;
/** A member can be observed idle this long after delivery before we trust it. */
const TURN_START_GRACE_MS = 20_000;
/** Max agent deliveries per human prompt, so an @-cascade can't loop forever. */
const MAX_HOPS = 24;
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
  private readonly hops = new Map<string, number>(); // roomId -> remaining budget
  private readonly statusWatchers = new Map<string, () => void>(); // memberId -> cancel

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
    if (message.mentions.length === 0) return;
    const snapshot = await getRoom(roomId);
    if (!snapshot || snapshot.room.status !== 'active') return;
    const { room, members } = snapshot;

    const author = message.authorMemberId
      ? members.find((m) => m.id === message.authorMemberId)
      : undefined;
    const fromHuman = !author || !author.runtime;
    // A fresh human prompt refills the cascade budget; agent-authored messages
    // spend it so a back-and-forth can't run away.
    if (fromHuman) this.hops.set(roomId, MAX_HOPS);

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
      const remaining = this.hops.get(roomId) ?? 0;
      if (remaining <= 0) {
        await postMessage({
          roomId,
          kind: 'system',
          body: `Routing paused — hit the ${MAX_HOPS}-message limit for this prompt. @mention a teammate to continue.`,
          mentions: [],
        });
        return;
      }
      this.hops.set(roomId, remaining - 1);
      await this.deliverTo(room.projectId, room.taskId, roomId, member, roster, {
        fromName,
        body: message.body,
      });
    }
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
      body: incoming.body,
    });

    let conversationId = member.conversationId;
    const existingSessionId = conversationId
      ? makePtySessionId(projectId, taskId, conversationId)
      : null;
    const alive =
      existingSessionId !== null && ptySessionRegistry.get(existingSessionId) !== undefined;

    try {
      // Make sure the team-at script is present in the worktree before the
      // agent could try to run it.
      await installTeamAtScript(projectId, taskId);
      if (!alive) {
        conversationId = randomUUID();
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
          initialPrompt: `${systemPrompt}\n\n${turnPrompt}`,
        });
        await setMemberConversation(member.id, conversationId);
        events.emit(teamRoomUpdatedChannel, { roomId }, roomId);
      } else if (conversationId && existingSessionId) {
        const ok = await injectPrompt(
          existingSessionId,
          { projectId, taskId, conversationId },
          runtime,
          turnPrompt
        );
        if (!ok) {
          await setMemberStatus(roomId, member.id, 'idle', conversationId);
          return;
        }
      }

      await setMemberStatus(roomId, member.id, 'running', conversationId);
      this.watchStatus(roomId, member.id, { projectId, taskId, conversationId: conversationId! });
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

  /** Mirror a member's roster dot to its session run-state until the turn ends. */
  private watchStatus(roomId: string, memberId: string, session: Session): void {
    this.statusWatchers.get(memberId)?.();
    const start = Date.now();
    let sawRunning = false;
    let last: MemberStatus | null = null;

    const timer = setInterval(() => {
      const raw = agentSessionRuntimeStore.getStatus(session);
      if (raw === 'working' || raw === 'awaiting-input') sawRunning = true;
      const terminal = raw === 'idle' || raw === 'completed' || raw === 'error';
      // Don't trust an early idle before the agent has actually started.
      if (terminal && !sawRunning && Date.now() - start < TURN_START_GRACE_MS) return;

      const mapped = mapStatus(raw);
      if (mapped !== last) {
        last = mapped;
        void setMemberStatus(roomId, memberId, mapped, session.conversationId).catch(() => {});
      }
      if (terminal) stop();
    }, STATUS_POLL_MS);

    const stop = () => {
      clearInterval(timer);
      this.statusWatchers.delete(memberId);
    };
    this.statusWatchers.set(memberId, stop);
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
  });
}
