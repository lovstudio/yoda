import { DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT } from '@shared/view-state';
import { type PinnedSidebarEntry } from './sidebar-store';
import {
  getSidebarTaskGroupDisclosure,
  visibleSidebarTaskGroupCountForItem,
  type SidebarTaskGroupRowVariant,
} from './sidebar-task-group';

export type PinnedTaskGroupToggleRow = {
  kind: 'task-group-toggle';
  groupId: string;
  hiddenCount: number;
  rowVariant: SidebarTaskGroupRowVariant;
};

export type PinnedTaskListRow = PinnedSidebarEntry | PinnedTaskGroupToggleRow;

const DIRECT_PINNED_TASK_GROUP_ID = 'pinned-tasks';
const pinnedProjectTaskGroupId = (projectId: string) => `pinned-project-tasks::${projectId}`;

export function limitPinnedTaskListRows(
  entries: readonly PinnedSidebarEntry[],
  visibleTaskCountByGroupId: ReadonlyMap<string, number>,
  visibleLimit = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT
): PinnedTaskListRow[] {
  const rows: PinnedTaskListRow[] = [];
  let index = 0;

  while (index < entries.length) {
    const entry = entries[index];

    if (entry.kind === 'project') {
      rows.push(entry);
      index += 1;
      const projectTasks = takePinnedProjectTasks(entries, index, entry.projectId);
      appendTaskGroupRows(
        rows,
        projectTasks.entries,
        pinnedProjectTaskGroupId(entry.projectId),
        visibleTaskCountByGroupId,
        'underProject',
        visibleLimit
      );
      index = projectTasks.nextIndex;
      continue;
    }

    if (entry.kind === 'task') {
      const directTasks = takeDirectPinnedTasks(entries, index);
      appendTaskGroupRows(
        rows,
        directTasks.entries,
        DIRECT_PINNED_TASK_GROUP_ID,
        visibleTaskCountByGroupId,
        'pinned',
        visibleLimit
      );
      index = directTasks.nextIndex;
      continue;
    }

    // The store emits project-task rows immediately after their project.
    // Preserve a malformed/orphaned row instead of dropping it silently.
    rows.push(entry);
    index += 1;
  }

  return rows;
}

export function findHiddenPinnedTaskGroupId(
  entries: readonly PinnedSidebarEntry[],
  visibleTaskCountByGroupId: ReadonlyMap<string, number>,
  projectId: string,
  taskId: string,
  visibleLimit = DEFAULT_SIDEBAR_TASK_GROUP_VISIBLE_LIMIT
): { groupId: string; visibleCount: number } | null {
  let index = 0;

  while (index < entries.length) {
    const entry = entries[index];

    if (entry.kind === 'project') {
      index += 1;
      const groupId = pinnedProjectTaskGroupId(entry.projectId);
      const projectTasks = takePinnedProjectTasks(entries, index, entry.projectId);
      const visibleCount = visibleTaskCountByGroupId.get(groupId) ?? visibleLimit;
      const requiredVisibleCount = visibleSidebarTaskGroupCountForItem(
        projectTasks.entries,
        (task) => task.projectId === projectId && task.taskId === taskId,
        visibleCount
      );
      if (requiredVisibleCount !== null) {
        return { groupId, visibleCount: requiredVisibleCount };
      }
      index = projectTasks.nextIndex;
      continue;
    }

    if (entry.kind === 'task') {
      const directTasks = takeDirectPinnedTasks(entries, index);
      const visibleCount =
        visibleTaskCountByGroupId.get(DIRECT_PINNED_TASK_GROUP_ID) ?? visibleLimit;
      const requiredVisibleCount = visibleSidebarTaskGroupCountForItem(
        directTasks.entries,
        (task) => task.projectId === projectId && task.taskId === taskId,
        visibleCount
      );
      if (requiredVisibleCount !== null) {
        return {
          groupId: DIRECT_PINNED_TASK_GROUP_ID,
          visibleCount: requiredVisibleCount,
        };
      }
      index = directTasks.nextIndex;
      continue;
    }

    index += 1;
  }

  return null;
}

function appendTaskGroupRows<T extends PinnedSidebarEntry>(
  target: PinnedTaskListRow[],
  entries: readonly T[],
  groupId: string,
  visibleTaskCountByGroupId: ReadonlyMap<string, number>,
  rowVariant: SidebarTaskGroupRowVariant,
  visibleLimit: number
): void {
  if (entries.length === 0) return;

  const visibleCount = visibleTaskCountByGroupId.get(groupId) ?? visibleLimit;
  const { visibleItems, hiddenCount } = getSidebarTaskGroupDisclosure(entries, visibleCount);
  target.push(...visibleItems);

  if (hiddenCount > 0) {
    target.push({
      kind: 'task-group-toggle',
      groupId,
      hiddenCount,
      rowVariant,
    });
  }
}

function takePinnedProjectTasks(
  entries: readonly PinnedSidebarEntry[],
  startIndex: number,
  projectId: string
): { entries: Extract<PinnedSidebarEntry, { kind: 'project-task' }>[]; nextIndex: number } {
  const projectTasks: Extract<PinnedSidebarEntry, { kind: 'project-task' }>[] = [];
  let nextIndex = startIndex;

  while (nextIndex < entries.length) {
    const entry = entries[nextIndex];
    if (entry.kind !== 'project-task' || entry.projectId !== projectId) break;
    projectTasks.push(entry);
    nextIndex += 1;
  }

  return { entries: projectTasks, nextIndex };
}

function takeDirectPinnedTasks(
  entries: readonly PinnedSidebarEntry[],
  startIndex: number
): { entries: Extract<PinnedSidebarEntry, { kind: 'task' }>[]; nextIndex: number } {
  const directTasks: Extract<PinnedSidebarEntry, { kind: 'task' }>[] = [];
  let nextIndex = startIndex;

  while (nextIndex < entries.length) {
    const entry = entries[nextIndex];
    if (entry.kind !== 'task') break;
    directTasks.push(entry);
    nextIndex += 1;
  }

  return { entries: directTasks, nextIndex };
}
