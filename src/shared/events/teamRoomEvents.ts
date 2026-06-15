import { defineEvent } from '@shared/ipc/events';
import type { MemberStatus, RoomMessage } from '@shared/team-room';

/** A new message landed in a room (human post, agent hand-off, or system line). */
export const roomMessagePostedChannel = defineEvent<{
  roomId: string;
  message: RoomMessage;
}>('teamRoom:message-posted');

/** A member's status dot changed (mirrors the agent's run-state). */
export const roomMemberStatusChangedChannel = defineEvent<{
  roomId: string;
  memberId: string;
  status: MemberStatus;
  /** Set when the member's live session was (re)bound. */
  conversationId?: string | null;
}>('teamRoom:member-status-changed');

/** Room metadata changed (renamed, archived, member added). Renderer refetches. */
export const teamRoomUpdatedChannel = defineEvent<{
  roomId: string;
}>('teamRoom:updated');
