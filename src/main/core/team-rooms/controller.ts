import { createRPCController } from '@shared/ipc/rpc';
import type { RoomMember, RoomMessage, RoomSnapshot, TeamRoom } from '@shared/team-room';
import {
  createRoomFromTeam,
  seedFreeformRoom,
  seedReviewRoom,
  type CreateRoomFromTeamParams,
  type SeedFreeformRoomParams,
  type SeedReviewRoomParams,
} from './presets';
import {
  addMember,
  createRoom,
  getAllRooms,
  getMessages,
  getRoom,
  getRoomForTask,
  getRoomsForProject,
  postMessage,
  updateMemberProfile,
  updateRoomConfig,
  type AddMemberParams,
  type CreateRoomParams,
  type PostMessageParams,
  type UpdateMemberProfileParams,
  type UpdateRoomConfigParams,
} from './store';

export const teamRoomController = createRPCController({
  createRoom: (params: CreateRoomParams): Promise<TeamRoom> => createRoom(params),
  createReviewRoom: (params: SeedReviewRoomParams): Promise<string> => seedReviewRoom(params),
  createFreeformRoom: (params: SeedFreeformRoomParams): Promise<string> => seedFreeformRoom(params),
  createRoomFromTeam: (params: CreateRoomFromTeamParams): Promise<string> =>
    createRoomFromTeam(params),
  getAllRooms: (): Promise<TeamRoom[]> => getAllRooms(),
  getRoomsForProject: (projectId: string): Promise<TeamRoom[]> => getRoomsForProject(projectId),
  getRoom: (roomId: string): Promise<RoomSnapshot | null> => getRoom(roomId),
  getRoomForTask: (projectId: string, taskId: string): Promise<RoomSnapshot | null> =>
    getRoomForTask(projectId, taskId),
  addMember: (params: AddMemberParams): Promise<RoomMember> => addMember(params),
  updateRoomConfig: (params: UpdateRoomConfigParams): Promise<TeamRoom> => updateRoomConfig(params),
  updateMemberProfile: (params: UpdateMemberProfileParams): Promise<RoomMember> =>
    updateMemberProfile(params),
  postMessage: (params: PostMessageParams): Promise<RoomMessage> => postMessage(params),
  getMessages: (roomId: string): Promise<RoomMessage[]> => getMessages(roomId),
});
