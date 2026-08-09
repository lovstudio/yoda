import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskRestoredChannel } from '@shared/events/taskEvents';
import { emitTaskRestoredEvents } from './task-restored-events';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock('@main/lib/events', () => ({ events: { emit: mocks.emit } }));

describe('emitTaskRestoredEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('groups restored task ids by project before broadcasting', () => {
    emitTaskRestoredEvents([
      { id: 'task-a', projectId: 'project-1' },
      { id: 'task-b', projectId: 'project-2' },
      { id: 'task-c', projectId: 'project-1' },
    ]);

    expect(mocks.emit).toHaveBeenCalledTimes(2);
    expect(mocks.emit).toHaveBeenCalledWith(taskRestoredChannel, {
      projectId: 'project-1',
      restoredTaskIds: ['task-a', 'task-c'],
    });
    expect(mocks.emit).toHaveBeenCalledWith(taskRestoredChannel, {
      projectId: 'project-2',
      restoredTaskIds: ['task-b'],
    });
  });
});
