import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { TeamRoom } from '@shared/team-room';

const mocks = vi.hoisted(() => ({
  updateTaskStatus: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@main/core/tasks/operations/updateTaskStatus', () => ({
  updateTaskStatus: mocks.updateTaskStatus,
}));
vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

const room = {
  preset: 'freeform',
  projectId: 'project-1',
  taskId: 'task-1',
} satisfies Pick<TeamRoom, 'preset' | 'projectId' | 'taskId'>;

describe('completeTeamRoomTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateTaskStatus.mockResolvedValue(undefined);
  });

  it('persists done and broadcasts it for a generic team room', async () => {
    const { completeTeamRoomTask } = await import('./team-room-task-status');

    await expect(completeTeamRoomTask(room)).resolves.toBe(true);

    expect(mocks.updateTaskStatus).toHaveBeenCalledWith('task-1', 'done');
    expect(mocks.emit).toHaveBeenCalledWith(taskStatusUpdatedChannel, {
      taskId: 'task-1',
      projectId: 'project-1',
      status: 'done',
    });
  });

  it('leaves Feature Room tasks at their review gate', async () => {
    const { completeTeamRoomTask } = await import('./team-room-task-status');

    await expect(completeTeamRoomTask({ ...room, preset: 'feature-workflow' })).resolves.toBe(
      false
    );

    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
