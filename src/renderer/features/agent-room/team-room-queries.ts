import { type QueryClient } from '@tanstack/react-query';

export const allTeamRoomsQueryKey = ['teamRooms'] as const;
export const taskRoomQueryKey = (projectId: string, taskId: string) =>
  ['roomForTask', projectId, taskId] as const;

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
