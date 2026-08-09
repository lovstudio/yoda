import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import { FEATURE_WORKFLOW_ROOM_PRESET } from '@shared/feature-workflow';
import type { TeamRoom } from '@shared/team-room';
import { updateTaskStatus } from '@main/core/tasks/operations/updateTaskStatus';
import { events } from '@main/lib/events';

/**
 * Complete a task when a generic Agent Room has reached its human hand-off.
 * Feature Rooms keep their review gate and advance through FeatureService.
 */
export async function completeTeamRoomTask(
  room: Pick<TeamRoom, 'preset' | 'projectId' | 'taskId'>
): Promise<boolean> {
  if (room.preset === FEATURE_WORKFLOW_ROOM_PRESET) return false;

  await updateTaskStatus(room.taskId, 'done');
  events.emit(taskStatusUpdatedChannel, {
    taskId: room.taskId,
    projectId: room.projectId,
    status: 'done',
  });
  return true;
}
