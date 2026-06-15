import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  roomMemberStatusChangedChannel,
  roomMessagePostedChannel,
} from '@shared/events/teamRoomEvents';
import type { RuntimeId } from '@shared/runtime-registry';
import {
  parseMentions,
  type MemberAccent,
  type MemberStatus,
  type MessageKind,
  type RoomMember,
  type RoomMessage,
  type RoomPreset,
  type RoomSnapshot,
  type RoomVerdict,
  type TeamRoom,
} from '@shared/team-room';
import { db } from '@main/db/client';
import {
  roomMembers,
  roomMessages,
  teamRooms,
  type RoomMemberRow,
  type RoomMessageRow,
  type TeamRoomRow,
} from '@main/db/schema';
import { events } from '@main/lib/events';
import { teamRoomEvents } from './team-room-events';

// ── row → shared model ───────────────────────────────────────────────────────

function mapRoom(row: TeamRoomRow): TeamRoom {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    name: row.name,
    preset: row.preset as RoomPreset,
    status: row.status as TeamRoom['status'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMember(row: RoomMemberRow): RoomMember {
  return {
    id: row.id,
    roomId: row.roomId,
    conversationId: row.conversationId,
    handle: row.handle,
    displayName: row.displayName,
    role: row.role,
    runtime: (row.runtime as RuntimeId | null) ?? null,
    systemPrompt: row.systemPrompt,
    autoApprove: row.autoApprove,
    accent: row.accent as MemberAccent,
    status: row.status as MemberStatus,
    createdAt: row.createdAt,
  };
}

function mapMessage(row: RoomMessageRow): RoomMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    authorMemberId: row.authorMemberId,
    kind: row.kind as MessageKind,
    body: row.body,
    mentions: row.mentions ? (JSON.parse(row.mentions) as string[]) : [],
    sessionRef: row.sessionRef,
    verdict: (row.verdict as RoomVerdict | null) ?? null,
    createdAt: row.createdAt,
  };
}

// ── rooms ────────────────────────────────────────────────────────────────────

export type CreateRoomParams = {
  projectId: string;
  taskId: string;
  name: string;
  preset?: RoomPreset;
};

export async function createRoom(params: CreateRoomParams): Promise<TeamRoom> {
  const id = randomUUID();
  const [row] = await db
    .insert(teamRooms)
    .values({
      id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
      preset: params.preset ?? 'freeform',
      status: 'active',
      createdAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  return mapRoom(row);
}

export async function getRoomsForProject(projectId: string): Promise<TeamRoom[]> {
  const rows = await db
    .select()
    .from(teamRooms)
    .where(and(eq(teamRooms.projectId, projectId), eq(teamRooms.status, 'active')))
    .orderBy(asc(teamRooms.createdAt));
  return rows.map(mapRoom);
}

export async function getRoom(roomId: string): Promise<RoomSnapshot | null> {
  const [room] = await db.select().from(teamRooms).where(eq(teamRooms.id, roomId)).limit(1);
  if (!room) return null;
  const [members, messages] = await Promise.all([getMembers(roomId), getMessages(roomId)]);
  return { room: mapRoom(room), members, messages };
}

// ── members ──────────────────────────────────────────────────────────────────

export type AddMemberParams = {
  roomId: string;
  handle: string;
  displayName: string;
  role: string;
  runtime?: RuntimeId | null;
  systemPrompt?: string;
  autoApprove?: boolean;
  accent?: MemberAccent;
};

export async function addMember(params: AddMemberParams): Promise<RoomMember> {
  const id = randomUUID();
  const [row] = await db
    .insert(roomMembers)
    .values({
      id,
      roomId: params.roomId,
      handle: params.handle,
      displayName: params.displayName,
      role: params.role,
      runtime: params.runtime ?? null,
      systemPrompt: params.systemPrompt ?? '',
      autoApprove: params.autoApprove ?? false,
      accent: params.accent ?? 'slate',
      status: 'idle',
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  return mapMember(row);
}

export async function getMembers(roomId: string): Promise<RoomMember[]> {
  const rows = await db
    .select()
    .from(roomMembers)
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(asc(roomMembers.createdAt));
  return rows.map(mapMember);
}

/** Bind (or clear) a member's live session conversation. */
export async function setMemberConversation(
  memberId: string,
  conversationId: string | null
): Promise<void> {
  await db.update(roomMembers).set({ conversationId }).where(eq(roomMembers.id, memberId));
}

/** Update a member's status mirror and notify the renderer. */
export async function setMemberStatus(
  roomId: string,
  memberId: string,
  status: MemberStatus,
  conversationId?: string | null
): Promise<void> {
  await db.update(roomMembers).set({ status }).where(eq(roomMembers.id, memberId));
  events.emit(roomMemberStatusChangedChannel, { roomId, memberId, status, conversationId }, roomId);
}

// ── messages ───────────────────────────────────────────────────────────────────

export type PostMessageParams = {
  roomId: string;
  /** null = the human lead or a system message. */
  authorMemberId?: string | null;
  kind?: MessageKind;
  body: string;
  /** Defaults to mentions parsed from `body`. */
  mentions?: string[];
  sessionRef?: string | null;
  verdict?: RoomVerdict | null;
};

export async function postMessage(params: PostMessageParams): Promise<RoomMessage> {
  const id = randomUUID();
  const mentions = params.mentions ?? parseMentions(params.body);
  const [row] = await db
    .insert(roomMessages)
    .values({
      id,
      roomId: params.roomId,
      authorMemberId: params.authorMemberId ?? null,
      kind: params.kind ?? 'text',
      body: params.body,
      mentions: JSON.stringify(mentions),
      sessionRef: params.sessionRef ?? null,
      verdict: params.verdict ?? null,
      createdAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();
  // Bump room activity so the room list can sort by recency.
  await db
    .update(teamRooms)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(teamRooms.id, params.roomId));

  const message = mapMessage(row);
  // Renderer-facing (per-room topic) + main-only hook for the routing engine.
  events.emit(roomMessagePostedChannel, { roomId: params.roomId, message }, params.roomId);
  teamRoomEvents._emit('room:message-posted', params.roomId, message);
  return message;
}

export async function getMessages(roomId: string): Promise<RoomMessage[]> {
  const rows = await db
    .select()
    .from(roomMessages)
    .where(eq(roomMessages.roomId, roomId))
    .orderBy(asc(roomMessages.createdAt));
  return rows.map(mapMessage);
}
