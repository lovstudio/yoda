import { makeAutoObservable, runInAction } from 'mobx';
import {
  roomMemberStatusChangedChannel,
  roomMessagePostedChannel,
  teamRoomUpdatedChannel,
} from '@shared/events/teamRoomEvents';
import type { RoomSnapshot, TeamRoom } from '@shared/team-room';
import { events, rpc } from '@renderer/lib/ipc';

/**
 * Renderer state for the Agent Room (Team Room) chat. Module singleton — the
 * Library section is global, and rooms span projects. Subscribes to the active
 * room's per-room event topics for live message/status updates.
 */
class AgentRoomStore {
  rooms: TeamRoom[] = [];
  activeRoomId: string | null = null;
  snapshot: RoomSnapshot | null = null;
  loadingRooms = false;
  loadingRoom = false;
  /** Conversation id whose live session is expanded inline, if any. */
  inspectedConversationId: string | null = null;

  private disposers: (() => void)[] = [];

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  async loadRooms(): Promise<void> {
    this.loadingRooms = true;
    try {
      const rooms = await rpc.teamRooms.getAllRooms();
      runInAction(() => {
        this.rooms = rooms;
        if (!this.activeRoomId && rooms.length > 0) void this.selectRoom(rooms[0].id);
      });
    } finally {
      runInAction(() => {
        this.loadingRooms = false;
      });
    }
  }

  async selectRoom(roomId: string): Promise<void> {
    if (this.activeRoomId === roomId && this.snapshot) return;
    this.activeRoomId = roomId;
    this.snapshot = null;
    this.inspectedConversationId = null;
    this.resubscribe(roomId);
    await this.refreshSnapshot();
  }

  async refreshSnapshot(): Promise<void> {
    const roomId = this.activeRoomId;
    if (!roomId) return;
    this.loadingRoom = true;
    try {
      const snapshot = await rpc.teamRooms.getRoom(roomId);
      runInAction(() => {
        if (this.activeRoomId === roomId) this.snapshot = snapshot;
      });
    } finally {
      runInAction(() => {
        this.loadingRoom = false;
      });
    }
  }

  /** Post a human (lead) message into the active room; the conductor routes it. */
  async postLeadMessage(body: string): Promise<void> {
    const room = this.snapshot;
    if (!room || !body.trim()) return;
    const lead = room.members.find((m) => m.role === 'lead');
    await rpc.teamRooms.postMessage({
      roomId: room.room.id,
      authorMemberId: lead?.id ?? null,
      kind: 'text',
      body: body.trim(),
    });
    // The message lands via the roomMessagePostedChannel subscription.
  }

  async createReviewRoom(params: {
    projectId: string;
    taskId: string;
    name: string;
    requirement: string;
    implementerRuntime: string;
    reviewerRuntime: string;
  }): Promise<void> {
    const roomId = await rpc.teamRooms.createReviewRoom({
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
      requirement: params.requirement,
      implementer: { runtime: params.implementerRuntime as never },
      reviewer: { runtime: params.reviewerRuntime as never },
    });
    await this.loadRooms();
    await this.selectRoom(roomId);
  }

  setInspectedConversation(conversationId: string | null): void {
    this.inspectedConversationId =
      this.inspectedConversationId === conversationId ? null : conversationId;
  }

  private resubscribe(roomId: string): void {
    for (const off of this.disposers) off();
    this.disposers = [
      events.on(
        roomMessagePostedChannel,
        (payload) => {
          if (payload.roomId !== this.activeRoomId || !this.snapshot) return;
          if (this.snapshot.messages.some((m) => m.id === payload.message.id)) return;
          runInAction(() => {
            this.snapshot?.messages.push(payload.message);
          });
        },
        roomId
      ),
      events.on(
        roomMemberStatusChangedChannel,
        (payload) => {
          if (payload.roomId !== this.activeRoomId || !this.snapshot) return;
          runInAction(() => {
            const member = this.snapshot?.members.find((m) => m.id === payload.memberId);
            if (member) {
              member.status = payload.status;
              if (payload.conversationId) member.conversationId = payload.conversationId;
            }
          });
        },
        roomId
      ),
      events.on(
        teamRoomUpdatedChannel,
        (payload) => {
          if (payload.roomId === this.activeRoomId) void this.refreshSnapshot();
        },
        roomId
      ),
    ];
  }

  dispose(): void {
    for (const off of this.disposers) off();
    this.disposers = [];
  }
}

export const agentRoomStore = new AgentRoomStore();
