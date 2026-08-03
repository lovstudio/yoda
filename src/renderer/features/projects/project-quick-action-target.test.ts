import { describe, expect, it, vi } from 'vitest';
import type { QuickAction } from '@shared/project-settings';
import { createUnregisteredTask } from '@renderer/features/tasks/stores/task';
import {
  getRunningProjectQuickActionTarget,
  openProjectQuickActionTarget,
} from './project-quick-action-target';
import type { MountedProject } from './stores/project';

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn(() => () => {}) },
  rpc: {},
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: { agentRuntime: { taskSessionStatuses: vi.fn(() => []) } },
}));

describe('project quick action target', () => {
  it('returns to the task created by a running Skill action', async () => {
    const task = createUnregisteredTask({
      id: 'task-1',
      name: 'Review changes',
      status: 'in_progress',
      lastInteractedAt: '2026-08-03T00:00:00.000Z',
      createdAt: '2026-08-03T00:00:00.000Z',
      statusChangedAt: '2026-08-03T00:00:00.000Z',
      isPinned: false,
      isLongTerm: false,
      needsReview: false,
      quickActionId: 'review',
    });
    const project = {
      taskManager: { tasks: new Map([['task-1', task]]) },
    } as unknown as MountedProject;
    const action: QuickAction = {
      id: 'review',
      label: 'Review changes',
      command: 'Review the current changes.',
      kind: 'skill',
    };

    const target = getRunningProjectQuickActionTarget(project, action);

    expect(target).toEqual({ kind: 'task', taskId: 'task-1' });
    if (!target) throw new Error('Expected a running quick action target.');
    const openTask = vi.fn();
    await expect(openProjectQuickActionTarget(project, target, openTask)).resolves.toBe(true);
    expect(openTask).toHaveBeenCalledWith('task-1');
  });
});
