import { randomUUID } from 'node:crypto';
import type { AgentSessionRuntimeStatus } from '@shared/events/agentEvents';
import { teamRoomUpdatedChannel } from '@shared/events/teamRoomEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { parseReviewResult } from '@shared/review-protocol';
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
/**
 * A member observed running but producing no new output for this long, while its
 * run-state is not actively `working`, is treated as stalled — its turn is ended
 * (fail-forward), so a wedged session can't hang the loop forever.
 */
const STALL_MS = 90_000;
/** Cadence of the conductor's "standup" roster summary while work is in progress. */
const STANDUP_MS = 120_000;
/** Max agent deliveries per human prompt, so an @-cascade can't loop forever. */
const MAX_HOPS = 24;
/** The reserved broadcast handle. */
const ALL_HANDLE = 'all';

/**
 * What the conductor injects to start a reviewer's turn each round. The reviewer
 * ends with the `YODA_REVIEW_RESULT` marker; the verdict is the turn-end signal,
 * so this drives the loop without depending on the agent running `team-at`.
 */
const REVIEW_REQUEST =
  'The implementer just finished a round. Review the current worktree against the original requirement (do NOT modify files). ' +
  'List any concrete fixes needed, then end your turn with exactly one line: `YODA_REVIEW_RESULT: PASS` if it fully meets the requirement, or `YODA_REVIEW_RESULT: FAIL` if changes are needed.';

type Session = { projectId: string; taskId: string; conversationId: string };

/** Drives the deterministic review-loop step when a member's turn ends. */
type ReviewWatch = {
  role: 'leader' | 'worker';
  sessionId: string;
  /** Marker count before this round, so a stale verdict from a prior round doesn't count. */
  baselineMarkers: number;
  onFinish: (verdict?: { passed: boolean; feedback: string }) => void;
};

/** Keep room chat readable — full agent output stays one click away in its session. */
const CHAT_FEEDBACK_MAX = 800;
function clip(text: string, max = CHAT_FEEDBACK_MAX): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
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
  private readonly hops = new Map<string, number>(); // roomId -> remaining budget
  private readonly statusWatchers = new Map<string, () => void>(); // memberId -> cancel
  private readonly standups = new Map<string, () => void>(); // roomId -> stop
  private readonly activity = new Map<string, number>(); // memberId -> last PTY-growth ts

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
        reviewLoop: room.preset === 'review-loop',
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
    incoming: { fromName: string; body: string; reviewLoop?: boolean }
  ): Promise<void> {
    const runtime = member.runtime as RuntimeId;
    const turnPrompt = buildMemberTurnPrompt({
      fromDisplayName: incoming.fromName,
      // Strip the leading @handle(s) — they addressed the message, they aren't
      // part of what the teammate is being asked to do.
      body: incoming.body.replace(/^(?:\s*@[a-z0-9][a-z0-9_-]*)+[ \t]*/i, '').trimStart(),
    });

    let conversationId = member.conversationId;
    const existingSessionId = conversationId
      ? makePtySessionId(projectId, taskId, conversationId)
      : null;
    const alive =
      existingSessionId !== null && ptySessionRegistry.get(existingSessionId) !== undefined;
    // Baseline the reviewer's marker count BEFORE this round so a stale verdict
    // left in its reused PTY buffer isn't mistaken for a fresh one.
    const baselineMarkers =
      incoming.reviewLoop && existingSessionId
        ? parseReviewResult(ptySessionRegistry.snapshot(existingSessionId)).markerCount
        : 0;

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
          autoRouted: incoming.reviewLoop,
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
      const review: ReviewWatch | undefined = incoming.reviewLoop
        ? {
            role: member.role === 'leader' ? 'leader' : 'worker',
            sessionId: makePtySessionId(projectId, taskId, conversationId!),
            baselineMarkers,
            onFinish: (verdict) => void this.advanceReviewLoop(roomId, member, verdict),
          }
        : undefined;
      this.watchStatus(
        roomId,
        member.id,
        { projectId, taskId, conversationId: conversationId! },
        review
      );
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
   * Mirror a member's roster dot to its session run-state until the turn ends.
   * For review-loop members, also detect turn-end and fire `review.onFinish` to
   * advance the loop: the reviewer ends on its `YODA_REVIEW_RESULT` marker
   * (independent of provider run-state, so codex's missing `task_complete` can't
   * stall it); the implementer ends on a terminal run-state.
   */
  private watchStatus(
    roomId: string,
    memberId: string,
    session: Session,
    review?: ReviewWatch
  ): void {
    this.statusWatchers.get(memberId)?.();
    const sessionId = makePtySessionId(session.projectId, session.taskId, session.conversationId);
    const start = Date.now();
    let sawRunning = false;
    let last: MemberStatus | null = null;
    let lastLen = ptySessionRegistry.snapshot(sessionId).length;
    let lastGrowAt = start;

    const timer = setInterval(() => {
      const snapshot = ptySessionRegistry.snapshot(sessionId);
      // Heartbeat: output growth means the member is alive and making progress.
      if (snapshot.length > lastLen) {
        lastLen = snapshot.length;
        lastGrowAt = Date.now();
        this.activity.set(memberId, lastGrowAt);
      }

      // Reviewer's fresh verdict ends the turn even if run-state never goes idle.
      if (review?.role === 'worker') {
        const result = parseReviewResult(snapshot);
        if (result.markerCount > review.baselineMarkers) {
          stop();
          review.onFinish({ passed: result.passed, feedback: result.feedback });
          return;
        }
      }

      const raw = agentSessionRuntimeStore.getStatus(session);
      if (raw === 'working' || raw === 'awaiting-input') sawRunning = true;
      const terminal = raw === 'idle' || raw === 'completed' || raw === 'error';
      // Don't trust an early idle before the agent has actually started.
      if (terminal && !sawRunning && Date.now() - start < TURN_START_GRACE_MS) return;
      // Stall fail-forward applies ONLY to the reviewer: it's read-only, so a long
      // silence means a wedged session (e.g. codex pinned at `working`, never
      // writing task_complete) rather than a slow build. Never on `awaiting-input`
      // (the agent is waiting on the user) or on the implementer (which can run
      // legitimately quiet commands and has a reliable run-state turn-end).
      const stalled =
        review?.role === 'worker' &&
        sawRunning &&
        raw !== 'awaiting-input' &&
        Date.now() - lastGrowAt > STALL_MS;

      const mapped = mapStatus(raw);
      if (mapped !== last) {
        last = mapped;
        void setMemberStatus(roomId, memberId, mapped, session.conversationId).catch(() => {});
      }
      if (terminal || stalled) {
        stop();
        if (stalled && review) {
          void setMemberStatus(roomId, memberId, 'finished', session.conversationId).catch(
            () => {}
          );
          void postMessage({
            roomId,
            kind: 'system',
            body: `Heartbeat — no progress from this member for a while; moving the loop forward.`,
            mentions: [],
          }).catch(() => {});
        }
        if (review && raw !== 'error') {
          // Ended (or stalled). Reviewer without a fresh marker → treat its tail
          // as fix notes (FAIL); implementer end → bring in the reviewer.
          const verdict =
            review.role === 'worker'
              ? { passed: false, feedback: parseReviewResult(snapshot).feedback }
              : undefined;
          review.onFinish(verdict);
        }
      }
    }, STATUS_POLL_MS);

    const stop = () => {
      clearInterval(timer);
      this.statusWatchers.delete(memberId);
    };
    this.statusWatchers.set(memberId, stop);
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

  /**
   * Deterministic review-loop step, run when a review-loop member's turn ends.
   * Posts the next routing message (reusing {@link onMessage} for delivery) so
   * the loop advances without the agent having to run `team-at`:
   * - implementer finished → bring in the reviewer.
   * - reviewer PASS → announce completion to the lead and stop.
   * - reviewer FAIL → forward its fix notes to the implementer for another round.
   */
  private async advanceReviewLoop(
    roomId: string,
    finished: RoomMember,
    verdict?: { passed: boolean; feedback: string }
  ): Promise<void> {
    const snapshot = await getRoom(roomId);
    if (!snapshot || snapshot.room.status !== 'active') return;
    if (snapshot.room.preset !== 'review-loop') return;
    const { members } = snapshot;
    const leader = members.find((m) => m.role === 'leader' && m.runtime);
    const reviewer = members.find((m) => m.role === 'worker' && m.runtime);
    if (!leader || !reviewer) return;

    if (finished.id === leader.id) {
      await postMessage({
        roomId,
        kind: 'system',
        body: `${leader.displayName} finished a round — bringing in ${reviewer.displayName} to review.`,
        mentions: [],
      });
      await postMessage({
        roomId,
        authorMemberId: leader.id,
        kind: 'handoff',
        body: `@${reviewer.handle} ${REVIEW_REQUEST}`,
        mentions: [reviewer.handle.toLowerCase()],
        sessionRef: leader.conversationId,
      });
      return;
    }

    if (finished.id === reviewer.id) {
      const note = clip(verdict?.feedback ?? '');
      if (verdict?.passed) {
        await postMessage({
          roomId,
          authorMemberId: reviewer.id,
          kind: 'handoff',
          body: `@you Review passed.${note ? `\n\n${note}` : ''}`,
          mentions: ['you'],
          sessionRef: reviewer.conversationId,
        });
        await postMessage({
          roomId,
          kind: 'system',
          body: `Review loop complete — ${reviewer.displayName} approved the work.`,
          mentions: [],
        });
        return;
      }
      await postMessage({
        roomId,
        authorMemberId: reviewer.id,
        kind: 'handoff',
        body: `@${leader.handle} ${note || 'Re-check the implementation against the requirement.'}`,
        mentions: [leader.handle.toLowerCase()],
        sessionRef: reviewer.conversationId,
      });
    }
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
  if (!found) return;
  await postMessage({
    roomId: found.roomId,
    authorMemberId: found.member.id,
    kind: 'text',
    body: message.trim(),
    mentions: [],
    sessionRef: found.member.conversationId,
  });
}
