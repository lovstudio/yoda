import { createRPCController } from '@shared/ipc/rpc';
import type { RoomMember, RoomMessage, RoomSnapshot, TeamRoom } from '@shared/team-room';
import {
  addMember,
  createRoom,
  getMessages,
  getRoom,
  getRoomsForProject,
  postMessage,
  type AddMemberParams,
  type CreateRoomParams,
  type PostMessageParams,
} from './store';

export const teamRoomController = createRPCController({
  createRoom: (params: CreateRoomParams): Promise<TeamRoom> => createRoom(params),
  getRoomsForProject: (projectId: string): Promise<TeamRoom[]> => getRoomsForProject(projectId),
  getRoom: (roomId: string): Promise<RoomSnapshot | null> => getRoom(roomId),
  addMember: (params: AddMemberParams): Promise<RoomMember> => addMember(params),
  postMessage: (params: PostMessageParams): Promise<RoomMessage> => postMessage(params),
  getMessages: (roomId: string): Promise<RoomMessage[]> => getMessages(roomId),
});
