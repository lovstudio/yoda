import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRoomTaskAvailable } from './ensure-room-task';

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  provisionTask: vi.fn(),
  resolveTask: vi.fn(),
}));

vi.mock('@main/core/projects/operations/openProject', () => ({ openProject: mocks.openProject }));
vi.mock('@main/core/projects/utils', () => ({ resolveTask: mocks.resolveTask }));
vi.mock('@main/core/tasks/provisionTask', () => ({ provisionTask: mocks.provisionTask }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureRoomTaskAvailable', () => {
  it('keeps an already provisioned task untouched', async () => {
    mocks.resolveTask.mockReturnValue({ conversations: { taskPath: '/tmp/task' } });

    await ensureRoomTaskAvailable('project-1', 'task-1');

    expect(mocks.openProject).not.toHaveBeenCalled();
    expect(mocks.provisionTask).not.toHaveBeenCalled();
  });

  it('restores project and task providers for a background room after restart', async () => {
    mocks.resolveTask
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ conversations: { taskPath: '/tmp/task' } });
    mocks.openProject.mockResolvedValue({ success: true, data: undefined });
    mocks.provisionTask.mockResolvedValue({ path: '/tmp/task' });

    await ensureRoomTaskAvailable('project-1', 'task-1');

    expect(mocks.openProject).toHaveBeenCalledWith('project-1');
    expect(mocks.provisionTask).toHaveBeenCalledWith('task-1');
  });

  it('reports the project mount failure before provisioning the task', async () => {
    mocks.resolveTask.mockReturnValue(null);
    mocks.openProject.mockResolvedValue({
      success: false,
      error: { type: 'path-not-found', path: '/missing/project' },
    });

    await expect(ensureRoomTaskAvailable('project-1', 'task-1')).rejects.toThrow(
      'Agent Room project could not be opened: project path is missing: /missing/project'
    );
    expect(mocks.provisionTask).not.toHaveBeenCalled();
  });
});
