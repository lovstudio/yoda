import type { TaskViewItem } from '@shared/task-view-options';
import type { SidebarTaskPriorityGroup } from '@shared/view-state';
import { registeredTaskData, unregisteredTaskData, type TaskStore } from './task';

/**
 * Project the fields the shared view-options menu filters and sorts on out of a
 * task store. One adapter, so every task-listing surface reads the same values
 * — a surface that sorted by its own notion of "updated" would order the same
 * tasks differently from its neighbour.
 *
 * `status` is supplied by the caller because classification lives in the sidebar
 * store (`taskPriorityGroup`), which owns the runtime read model.
 */
export function taskViewItemFields(
  task: TaskStore,
  status: SidebarTaskPriorityGroup,
  projectName: string
): Omit<TaskViewItem, 'projectId'> {
  const registered = registeredTaskData(task);
  const unregistered = unregisteredTaskData(task);
  const createdAt = registered?.createdAt ?? unregistered?.createdAt ?? '';
  return {
    projectName,
    status,
    name: registered?.name ?? unregistered?.name ?? task.data.id,
    createdAt,
    // A task that has never been interacted with sorts by its creation instant
    // rather than sinking below every task that has.
    lastInteractedAt: registered?.lastInteractedAt ?? unregistered?.lastInteractedAt ?? createdAt,
    statusChangedAt: registered?.statusChangedAt ?? unregistered?.statusChangedAt ?? createdAt,
  };
}
