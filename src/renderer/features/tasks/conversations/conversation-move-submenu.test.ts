import { describe, expect, it, vi } from 'vitest';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { conversationMoveTargets } from './conversation-move-submenu';

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task', () => ({
  registeredTaskData: (store: TaskStore) =>
    store.state === 'unregistered' ? undefined : store.data,
}));

vi.mock('./move-conversation-to-task', () => ({
  moveConversationToTask: vi.fn(),
}));

function task(
  id: string,
  overrides: { archivedAt?: string; archiveRequestedAt?: string } = {}
): TaskStore {
  return {
    state: 'unprovisioned',
    data: { id, name: `Task ${id}`, ...overrides },
  } as unknown as TaskStore;
}

describe('conversationMoveTargets', () => {
  it('offers only active sibling tasks from the current project manager', () => {
    expect(
      conversationMoveTargets(
        [
          task('current'),
          task('available'),
          task('archived', { archivedAt: '2026-07-19T00:00:00.000Z' }),
          task('archiving', { archiveRequestedAt: '2026-07-19T00:00:00.000Z' }),
        ],
        'current'
      )
    ).toEqual([{ id: 'available', name: 'Task available' }]);
  });
});
