import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { TeamRoom } from '@shared/team-room';
import { updateTaskStatus } from '@main/core/tasks/operations/updateTaskStatus';
import { events } from '@main/lib/events';

/** Complete a task when its Agent Room has reached its human hand-off. */
export async function completeTeamRoomTask(
  room: Pick<TeamRoom, 'projectId' | 'taskId'>
): Promise<boolean> {
  await updateTaskStatus(room.taskId, 'done');
  events.emit(taskStatusUpdatedChannel, {
    taskId: room.taskId,
    projectId: room.projectId,
    status: 'done',
  });
  return true;
}
