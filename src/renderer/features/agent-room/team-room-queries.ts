import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type TeamRoom } from '@shared/team-room';
import { rpc } from '@renderer/lib/ipc';

export const allTeamRoomsQueryKey = ['teamRooms'] as const;
export const taskRoomQueryKey = (projectId: string, taskId: string) =>
  ['roomForTask', projectId, taskId] as const;

export function teamRoomTaskKey(projectId: string, taskId: string): string {
  return `${projectId}::${taskId}`;
}

export function useTeamRoomTaskKeys(): ReadonlySet<string> {
  const { data: rooms = [] } = useQuery<TeamRoom[]>({
    queryKey: allTeamRoomsQueryKey,
    queryFn: () => rpc.teamRooms.getAllRooms(),
  });

  return useMemo(
    () => new Set(rooms.map((room) => teamRoomTaskKey(room.projectId, room.taskId))),
    [rooms]
  );
}

export function invalidateTeamRoomQueries(
  queryClient: QueryClient,
  projectId: string,
  taskId: string
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: allTeamRoomsQueryKey }),
    queryClient.invalidateQueries({ queryKey: taskRoomQueryKey(projectId, taskId) }),
  ]).then(() => undefined);
}
