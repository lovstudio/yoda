import type { RuntimeId } from './runtime-registry';

/** Preset that seeded a room. `review-loop` wires implementer↔reviewer routing. */
export type RoomPreset = 'freeform' | 'review-loop';

/**
 * Member lifecycle state shown as the roster dot, game-loop style:
 * - idle: no live session / nothing assigned
 * - waiting: queued to act but its turn hasn't started
 * - running: its agent session is actively working
 * - finished: completed its last turn
 * - error: its last turn failed
 * - awaiting-input: its session is blocked on a prompt (permission, question)
 */
export type MemberStatus = 'idle' | 'waiting' | 'running' | 'finished' | 'error' | 'awaiting-input';

/** Message provenance. `handoff` = an agent's conclusion; `verdict` = preset PASS/FAIL. */
export type MessageKind = 'text' | 'handoff' | 'system' | 'verdict';

export type RoomVerdict = 'pass' | 'fail';

/** Identity accent key; resolved to a concrete theme color in the renderer. */
export type MemberAccent = 'terra' | 'amber' | 'teal' | 'violet' | 'slate';

export interface TeamRoom {
  id: string;
  projectId: string;
  taskId: string;
  name: string;
  preset: RoomPreset;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  /** Live session conversation; null until the member first gets assigned work. */
  conversationId: string | null;
  handle: string;
  displayName: string;
  /** 'lead' is the human; agents use a role label like 'implementer' | 'reviewer'. */
  role: string;
  runtime: RuntimeId | null;
  systemPrompt: string;
  autoApprove: boolean;
  accent: MemberAccent;
  status: MemberStatus;
  createdAt: string;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  /** Authoring member; null = the human lead or a system message. */
  authorMemberId: string | null;
  kind: MessageKind;
  body: string;
  /** @handles this message addresses (drives routing). */
  mentions: string[];
  /** Conversation id of the session that produced this message. */
  sessionRef: string | null;
  verdict: RoomVerdict | null;
  createdAt: string;
}

/** Full room read model the renderer hydrates from. */
export interface RoomSnapshot {
  room: TeamRoom;
  members: RoomMember[];
  messages: RoomMessage[];
}

/** The human lead's reserved handle. */
export const LEAD_HANDLE = 'you';

const MENTION_RE = /@([a-z0-9][a-z0-9_-]*)/gi;

/** Extract the distinct @handles addressed by a message body (lowercased). */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const h = m[1]?.toLowerCase();
    if (h) out.add(h);
  }
  return [...out];
}
