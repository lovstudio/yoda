import { randomUUID } from 'node:crypto';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import type { RuntimeId } from '@shared/runtime-registry';
import {
  buildMemberTurnPrompt,
  buildTeammateSystemPrompt,
  countTeamMessages,
  teamMessageOrFallback,
  type RosterEntry,
} from '@shared/team-protocol';
import type { RoomMember, RoomMessage } from '@shared/team-room';
import { createConversation } from '@main/core/conversations/createConversation';
import { injectPrompt } from '@main/core/conversations/inject-prompt';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { getAllRooms, getRoom, postMessage, setMemberConversation, setMemberStatus } from './store';
import { teamRoomEvents } from './team-room-events';
import { waitForMemberTurn } from './turn-wait';

const POLL_MS = 1_500;
const TURN_TIMEOUT_MS = 30 * 60_000;
/** Max agent turns per human prompt, so an @-cascade can't loop forever. */
const MAX_HOPS = 16;

/**
 * Generic @-mention routing engine for Team Rooms — the generalization of the
 * review orchestrator. Watches every posted message; for each agent teammate
 * it addresses, dispatches a turn (spawning/reusing that member's session),
 * captures the member's hand-off block, and posts it back as a room message —
 * which re-enters routing if it @mentions someone else. Bounded by MAX_HOPS.
 */
class RoomConductor {
  private started = false;
  private readonly inFlight = new Set<string>(); // member ids currently working
  private readonly hops = new Map<string, number>(); // roomId -> remaining budget
  private readonly aborters = new Map<string, AbortController>(); // roomId -> abort

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

  abortRoom(roomId: string): void {
    this.aborters.get(roomId)?.abort();
    this.aborters.delete(roomId);
  }

  /**
   * Recover rooms left mid-turn by a previous app lifetime (reload, crash). The
   * in-flight PTY turn is gone, so: clear stale 'working'/'thinking' member dots,
   * then re-drive the last message if it still addresses an agent that never got
   * to reply (it's the last message, so by definition nothing followed it).
   */
  async resumePending(): Promise<void> {
    const rooms = await getAllRooms();
    for (const room of rooms) {
      const snapshot = await getRoom(room.id);
      if (!snapshot) continue;
      for (const member of snapshot.members) {
        if (member.runtime && member.status !== 'idle') {
          await setMemberStatus(room.id, member.id, 'idle', member.conversationId);
        }
      }
      const last = snapshot.messages.at(-1);
      if (!last || last.mentions.length === 0) continue;
      const pending = snapshot.members.some(
        (m) =>
          m.runtime &&
          m.id !== last.authorMemberId &&
          last.mentions.includes(m.handle.toLowerCase())
      );
      if (pending) {
        this.hops.set(room.id, MAX_HOPS);
        void this.onMessage(room.id, last).catch((e: unknown) => {
          log.warn('RoomConductor: resume failed', { roomId: room.id, error: String(e) });
        });
      }
    }
  }

  private signal(roomId: string): AbortSignal {
    let ac = this.aborters.get(roomId);
    if (!ac) {
      ac = new AbortController();
      this.aborters.set(roomId, ac);
    }
    return ac.signal;
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

    const targets = members.filter(
      (m) =>
        m.runtime &&
        m.id !== message.authorMemberId &&
        message.mentions.includes(m.handle.toLowerCase())
    );
    if (targets.length === 0) return;

    const roster: RosterEntry[] = members.map((m) => ({
      handle: m.handle,
      displayName: m.displayName,
      role: m.role,
    }));
    const fromName = author?.displayName ?? 'Lead';

    for (const member of targets) {
      const remaining = this.hops.get(roomId) ?? 0;
      if (remaining <= 0) {
        await postMessage({
          roomId,
          kind: 'system',
          body: `Routing paused — hit the ${MAX_HOPS}-turn limit for this prompt. @mention a teammate to continue.`,
          mentions: [],
        });
        return;
      }
      if (this.inFlight.has(member.id)) continue; // already working; skip duplicate ping
      this.hops.set(roomId, remaining - 1);
      await this.dispatchTurn(room.projectId, room.taskId, roomId, member, roster, {
        fromName,
        body: message.body,
      });
    }
  }

  private async dispatchTurn(
    projectId: string,
    taskId: string,
    roomId: string,
    member: RoomMember,
    roster: RosterEntry[],
    incoming: { fromName: string; body: string }
  ): Promise<void> {
    const runtime = member.runtime as RuntimeId;
    this.inFlight.add(member.id);
    try {
      await setMemberStatus(roomId, member.id, 'thinking', member.conversationId);

      const turnPrompt = buildMemberTurnPrompt({
        fromDisplayName: incoming.fromName,
        body: incoming.body,
      });

      let conversationId = member.conversationId;
      let sessionId = conversationId ? makePtySessionId(projectId, taskId, conversationId) : null;
      const alive = sessionId !== null && ptySessionRegistry.get(sessionId) !== undefined;
      let baselineCount = 0;

      if (!alive) {
        // First turn (or session died across a restart): spawn the member's
        // session with the teammate system prompt + this turn baked in.
        conversationId = randomUUID();
        sessionId = makePtySessionId(projectId, taskId, conversationId);
        const teammatePrompt = buildTeammateSystemPrompt({
          displayName: member.displayName,
          handle: member.handle,
          roster,
        });
        // Role prompt (e.g. "you are the reviewer…") + chat etiquette + this turn.
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
      } else if (sessionId) {
        baselineCount = countTeamMessages(ptySessionRegistry.snapshot(sessionId));
        const ok = await injectPrompt(
          sessionId,
          { projectId, taskId, conversationId: conversationId as string },
          runtime,
          turnPrompt
        );
        if (!ok) {
          await setMemberStatus(roomId, member.id, 'idle', conversationId);
          return;
        }
      }

      await setMemberStatus(roomId, member.id, 'working', conversationId);
      const outcome = await waitForMemberTurn(
        { projectId, taskId, conversationId: conversationId as string },
        sessionId as string,
        baselineCount,
        { signal: this.signal(roomId), timeoutMs: TURN_TIMEOUT_MS, pollMs: POLL_MS }
      );
      if (outcome.kind === 'aborted') {
        await setMemberStatus(roomId, member.id, 'idle', conversationId);
        return;
      }

      const body = teamMessageOrFallback(outcome.output);
      await postMessage({
        roomId,
        authorMemberId: member.id,
        kind: 'handoff',
        body,
        sessionRef: conversationId,
      });
      await setMemberStatus(roomId, member.id, 'idle', conversationId);
    } catch (error) {
      // A turn can fail to even start (e.g. the backing worktree isn't ready, or
      // the agent CLI failed to spawn). Don't leave the member stuck 'working';
      // surface it in the room and free the dot.
      await setMemberStatus(roomId, member.id, 'idle', member.conversationId).catch(() => {});
      await postMessage({
        roomId,
        kind: 'system',
        body: `${member.displayName} couldn't start its turn: ${
          error instanceof Error ? error.message : String(error)
        }`,
        mentions: [],
      }).catch(() => {});
    } finally {
      this.inFlight.delete(member.id);
    }
  }
}

export const roomConductor = new RoomConductor();
