import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useTabDropZone, type TabDragPayload, type TabDropEvent } from '@renderer/app/tab-drag';
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
import { type SidebarGroupKey, type SidebarRow } from '@renderer/features/sidebar/sidebar-store';
import {
  canMoveConversationToTask,
  conversationTransferFromPayload,
} from '@renderer/features/tasks/conversations/conversation-transfer';
import { moveConversationToTask } from '@renderer/features/tasks/conversations/move-conversation-to-task';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { PinnedRowContent, pinnedRowKey } from './pinned-task-list';
import {
  findHiddenPinnedTaskGroupId,
  limitPinnedTaskListRows,
  type PinnedTaskListRow,
} from './pinned-task-list-model';
import { SidebarProjectItem } from './project-item';
import { ProjectsGroupLabel } from './projects-group-label';
import { useSidebarDnd } from './sidebar-dnd-context';
import { SidebarSectionHeader } from './sidebar-primitives';
import {
  getSidebarTaskGroupDisclosure,
  hiddenSidebarTaskGroupItemsContain,
  type SidebarTaskGroupRowVariant,
} from './sidebar-task-group';
import { SidebarTaskGroupToggle } from './sidebar-task-group-toggle';
import { type TreeProjection } from './sidebar-tree-projection';
import { SidebarTaskItem } from './task-item';

export const SidebarVirtualList = observer(function SidebarVirtualList({
  scrollElementRef,
}: {
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = sidebarStore.sidebarRows;
  const pinnedEntries = sidebarStore.pinnedSidebarEntries;
  const teamRoomTaskKeys = useTeamRoomTaskKeys();
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const taskGroupVisibleLimit = sidebarStore.taskGroupVisibleLimit;
  const pinnedCollapsed = sidebarStore.pinnedCollapsed;
  const projectsCollapsed = sidebarStore.projectsCollapsed;
  const { activeId, dndEnabled, dropTargetProjectId, taskProjection } = useSidebarDnd();

  const autoExpandedActiveIdRef = useRef<string | null>(null);
  const autoExpandedPinnedTaskKeyRef = useRef<string | null>(null);
  const previousRowCountRef = useRef<number | null>(null);
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Set<string>>(() => new Set());
  const [expandedPinnedTaskGroupIds, setExpandedPinnedTaskGroupIds] = useState<Set<string>>(
    () => new Set()
  );

  // During a project drag, collapse its task children so the list is compact
  // and project rows are adjacent — making cross-project reorder easier.
  const draggingProjectId = activeId?.startsWith('proj::') ? activeId.slice(6) : null;
  // During a task drag, hide the task's descendant subtree — it travels with
  // the task, and excluding it makes a drop inside the own subtree impossible
  // (renderer-side cycle prevention; the main process re-validates anyway).
  const draggingTask = activeId?.startsWith('task::')
    ? { projectId: activeId.split('::')[1], taskId: activeId.split('::')[2] }
    : null;
  const displayRows = draggingProjectId
    ? rows.filter((r) => !(r.kind === 'task' && r.projectId === draggingProjectId))
    : draggingTask
      ? filterTaskDescendantRows(rows, draggingTask.projectId, draggingTask.taskId)
      : rows;
  const renderRows = useMemo(
    () => limitTaskGroupRows(displayRows, expandedTaskGroupIds, taskGroupVisibleLimit),
    [displayRows, expandedTaskGroupIds, taskGroupVisibleLimit]
  );
  const pinnedRows = useMemo(
    () => limitPinnedTaskListRows(pinnedEntries, expandedPinnedTaskGroupIds, taskGroupVisibleLimit),
    [expandedPinnedTaskGroupIds, pinnedEntries, taskGroupVisibleLimit]
  );
  const activeSidebarDndId = getActiveSidebarDndId(
    currentView,
    taskParams.projectId,
    taskParams.taskId,
    projectParams.projectId
  );
  const activePinnedTaskKey =
    taskParams.projectId && taskParams.taskId
      ? `${taskParams.projectId}::${taskParams.taskId}`
      : null;
  const navigationRows = useMemo(() => {
    const next: SidebarNavigationRow[] = [{ kind: 'pinned-header' }];
    if (!pinnedCollapsed) {
      next.push(...pinnedRows.map((row) => ({ kind: 'pinned-row' as const, row })));
    }
    next.push({ kind: 'projects-header' });
    if (!projectsCollapsed) {
      next.push(...renderRows.map((row) => ({ kind: 'project-row' as const, row })));
    }
    return next;
  }, [pinnedCollapsed, pinnedRows, projectsCollapsed, renderRows]);

  // Pinned and project rows share one virtualizer and one scroll coordinate
  // system. Keeping separate virtualizers over the same scroll root lets one
  // list retain height while the other temporarily has no rendered range.
  const virtualizer = useVirtualizer({
    count: navigationRows.length,
    getScrollElement: () => scrollElementRef.current,
    // The browser moves the shared scroll root before React can schedule an
    // async range update. Flush the virtual range in the same scroll turn so
    // fast wheel movement never exposes an empty viewport between row batches.
    useFlushSync: true,
    estimateSize: () => 32,
    overscan: 16,
    paddingEnd: 12,
    getItemKey: (index) => {
      const row = navigationRows[index];
      return row ? sidebarNavigationRowKey(row) : index;
    },
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // A task can arrive after the project row has already been measured. The
  // row model and the virtualizer cache then change in separate turns; clear
  // the cached measurements during layout so the new child enters the first
  // committed viewport instead of waiting for another sidebar interaction.
  useLayoutEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = navigationRows.length;
    if (previousRowCount === null || previousRowCount === navigationRows.length) return;
    virtualizer.measure();
  }, [navigationRows.length, virtualizer]);

  // Virtualizer state changes on every scroll frame. This scan only depends on
  // the row model, so keep it out of that frame-level render path.
  const activeRowIndex = useMemo(
    () =>
      activeSidebarDndId
        ? navigationRows.findIndex((row) => sidebarNavigationRowDndId(row) === activeSidebarDndId)
        : -1,
    [activeSidebarDndId, navigationRows]
  );

  useEffect(() => {
    if (activeId || activeRowIndex < 0) return;
    virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' });
  }, [activeId, activeRowIndex, activeSidebarDndId, virtualizer]);

  const allDndIds = useMemo(() => renderRows.filter(isSidebarRow).map(rowToDndId), [renderRows]);

  // Deferred reflow: keep needsReview demotion frozen while the pointer is
  // inside the list, so marking a task (or auto-clear on open) doesn't reorder
  // rows under the cursor. Release on leave/unmount lets the list reflow.
  useEffect(
    () => () => {
      sidebarStore.releaseTaskReflow('pinned-list');
      sidebarStore.releaseTaskReflow('projects-list');
    },
    []
  );

  useEffect(() => {
    if (!activePinnedTaskKey || !taskParams.projectId || !taskParams.taskId) {
      autoExpandedPinnedTaskKeyRef.current = null;
      return;
    }
    if (autoExpandedPinnedTaskKeyRef.current === activePinnedTaskKey) return;

    const hiddenGroupId = findHiddenPinnedTaskGroupId(
      pinnedEntries,
      expandedPinnedTaskGroupIds,
      taskParams.projectId,
      taskParams.taskId,
      taskGroupVisibleLimit
    );
    if (!hiddenGroupId) return;

    autoExpandedPinnedTaskKeyRef.current = activePinnedTaskKey;
    setExpandedPinnedTaskGroupIds((previous) => {
      if (previous.has(hiddenGroupId)) return previous;
      const next = new Set(previous);
      next.add(hiddenGroupId);
      return next;
    });
  }, [
    activePinnedTaskKey,
    expandedPinnedTaskGroupIds,
    pinnedEntries,
    taskGroupVisibleLimit,
    taskParams.projectId,
    taskParams.taskId,
  ]);

  // Reveal the active project/task if navigation lands inside a truncated group.
  useEffect(() => {
    if (!activeSidebarDndId) {
      autoExpandedActiveIdRef.current = null;
      return;
    }
    if (currentView === 'task' && taskParams.projectId && taskParams.taskId) {
      const activeTask = getRegisteredTaskData(taskParams.projectId, taskParams.taskId);
      if (activeTask?.archivedAt || activeTask?.archiveRequestedAt || activeTask?.needsReview) {
        return;
      }
    }
    if (autoExpandedActiveIdRef.current === activeSidebarDndId) return;

    const hiddenGroupId = findHiddenTaskGroupId(
      displayRows,
      expandedTaskGroupIds,
      activeSidebarDndId,
      taskGroupVisibleLimit
    );
    if (!hiddenGroupId) return;

    autoExpandedActiveIdRef.current = activeSidebarDndId;
    setExpandedTaskGroupIds((prev) => {
      if (prev.has(hiddenGroupId)) return prev;
      const next = new Set(prev);
      next.add(hiddenGroupId);
      return next;
    });
  }, [
    activeSidebarDndId,
    currentView,
    displayRows,
    expandedTaskGroupIds,
    taskGroupVisibleLimit,
    taskParams.projectId,
    taskParams.taskId,
  ]);

  const toggleTaskGroupExpanded = useCallback(
    (groupId: string) => {
      setExpandedTaskGroupIds((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          if (activeSidebarDndId) {
            autoExpandedActiveIdRef.current = activeSidebarDndId;
          }
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    },
    [activeSidebarDndId]
  );

  const togglePinnedTaskGroupExpanded = useCallback(
    (groupId: string) => {
      setExpandedPinnedTaskGroupIds((previous) => {
        const next = new Set(previous);
        if (next.has(groupId)) {
          if (activePinnedTaskKey) {
            autoExpandedPinnedTaskKeyRef.current = activePinnedTaskKey;
          }
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    },
    [activePinnedTaskKey]
  );

  const renderRow = (row: SidebarNavigationRow, virtualItem?: VirtualItem) => {
    const rowKey = sidebarNavigationRowKey(row);
    const rowContent = (
      <SidebarNavigationRowContent
        row={row}
        dndEnabled={dndEnabled}
        dropTargetProjectId={dropTargetProjectId}
        activeId={activeId}
        taskProjection={taskProjection}
        teamRoomTaskKeys={teamRoomTaskKeys}
        onToggleTaskGroup={toggleTaskGroupExpanded}
        onTogglePinnedTaskGroup={togglePinnedTaskGroupExpanded}
      />
    );

    if (!virtualItem) return <Fragment key={rowKey}>{rowContent}</Fragment>;
    return (
      <div
        // The row model can reorder while a virtualizer snapshot still refers
        // to the previous row at this index. React identity must follow the
        // current row, otherwise a stateful task row can briefly render the
        // previous task before the virtualizer catches up.
        key={rowKey}
        ref={virtualizer.measureElement}
        data-index={virtualItem.index}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          transform: `translateY(${virtualItem.start}px)`,
        }}
      >
        {rowContent}
      </div>
    );
  };

  return (
    <SortableContext items={allDndIds} strategy={verticalListSortingStrategy}>
      <div
        className="shrink-0 overflow-hidden"
        onPointerEnter={() => {
          sidebarStore.holdTaskReflow('pinned-list');
          sidebarStore.holdTaskReflow('projects-list');
        }}
        onPointerLeave={() => {
          sidebarStore.releaseTaskReflow('pinned-list');
          sidebarStore.releaseTaskReflow('projects-list');
        }}
      >
        {activeId ? (
          <div className="pb-3">{navigationRows.map((row) => renderRow(row))}</div>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) =>
              renderRow(navigationRows[virtualItem.index]!, virtualItem)
            )}
          </div>
        )}
      </div>
    </SortableContext>
  );
});

type SidebarTaskGroupToggleRow = {
  kind: 'task-group-toggle';
  groupId: string;
  hiddenCount: number;
  expanded: boolean;
  rowVariant: SidebarTaskGroupRowVariant;
};

type SidebarRenderableRow = SidebarRow | SidebarTaskGroupToggleRow;

type SidebarNavigationRow =
  | { kind: 'pinned-header' }
  | { kind: 'pinned-row'; row: PinnedTaskListRow }
  | { kind: 'projects-header' }
  | { kind: 'project-row'; row: SidebarRenderableRow };

const toProjectDndId = (id: string) => `proj::${id}`;
const toTaskDndId = (projectId: string, taskId: string) => `task::${projectId}::${taskId}`;
const toGroupDndId = (group: SidebarGroupKey) =>
  group.kind === 'type' ? `group::type::${group.type}` : `group::activity::${group.bucket}`;
const toProjectTaskGroupId = (projectId: string) => `project-tasks::${projectId}`;
const toDirectTaskGroupId = (group: SidebarGroupKey) => `direct-tasks::${toGroupDndId(group)}`;

function isSidebarRow(row: SidebarRenderableRow): row is SidebarRow {
  return row.kind !== 'task-group-toggle';
}

function sidebarRenderableRowKey(row: SidebarRenderableRow): string {
  if (row.kind === 'task-group-toggle') return `toggle:${row.groupId}`;
  return rowToDndId(row);
}

function sidebarNavigationRowKey(row: SidebarNavigationRow): string {
  if (row.kind === 'pinned-header' || row.kind === 'projects-header') return row.kind;
  return row.kind === 'pinned-row'
    ? `pinned:${pinnedRowKey(row.row)}`
    : `projects:${sidebarRenderableRowKey(row.row)}`;
}

function sidebarNavigationRowDndId(row: SidebarNavigationRow): string | null {
  if (row.kind === 'pinned-row') {
    return row.row.kind === 'task-group-toggle'
      ? null
      : 'taskId' in row.row
        ? toTaskDndId(row.row.projectId, row.row.taskId)
        : toProjectDndId(row.row.projectId);
  }
  if (row.kind === 'project-row' && isSidebarRow(row.row)) return rowToDndId(row.row);
  return null;
}

type SidebarNavigationRowContentProps = {
  row: SidebarNavigationRow;
  dndEnabled: boolean;
  dropTargetProjectId: string | null;
  activeId: string | null;
  taskProjection: TreeProjection | null;
  teamRoomTaskKeys: ReadonlySet<string>;
  onToggleTaskGroup: (groupId: string) => void;
  onTogglePinnedTaskGroup: (groupId: string) => void;
};

const SidebarNavigationRowContent = memo(function SidebarNavigationRowContent({
  row,
  dndEnabled,
  dropTargetProjectId,
  activeId,
  taskProjection,
  teamRoomTaskKeys,
  onToggleTaskGroup,
  onTogglePinnedTaskGroup,
}: SidebarNavigationRowContentProps) {
  const { t } = useTranslation();

  if (row.kind === 'pinned-header') {
    return (
      <SidebarSectionHeader
        label={t('sidebar.pinned')}
        collapsed={sidebarStore.pinnedCollapsed}
        onToggle={() => sidebarStore.togglePinnedCollapsed()}
      />
    );
  }
  if (row.kind === 'projects-header') return <ProjectsGroupLabel />;
  if (row.kind === 'pinned-row') {
    return (
      <div className="min-w-0 overflow-hidden px-3">
        <PinnedRowContent
          row={row.row}
          dndEnabled={dndEnabled}
          teamRoomTaskKeys={teamRoomTaskKeys}
          onToggleTaskGroup={onTogglePinnedTaskGroup}
        />
      </div>
    );
  }
  return (
    <div className="min-w-0 overflow-hidden px-3 pb-0.5">
      <SidebarRowContent
        row={row.row}
        dndEnabled={dndEnabled}
        dropTargetProjectId={dropTargetProjectId}
        activeId={activeId}
        taskProjection={taskProjection}
        teamRoomTaskKeys={teamRoomTaskKeys}
        onToggleTaskGroup={onToggleTaskGroup}
      />
    </div>
  );
});

type SidebarRowContentProps = {
  row: SidebarRenderableRow;
  dndEnabled: boolean;
  dropTargetProjectId: string | null;
  activeId: string | null;
  taskProjection: TreeProjection | null;
  teamRoomTaskKeys: ReadonlySet<string>;
  onToggleTaskGroup: (groupId: string) => void;
};

// The virtualizer re-renders its parent on every scroll frame. Keep the row's
// DnD/drop-zone hooks and task element reconciliation out of that frame when
// the row model and interaction state are unchanged.
const SidebarRowContent = memo(function SidebarRowContent({
  row,
  dndEnabled,
  dropTargetProjectId,
  activeId,
  taskProjection,
  teamRoomTaskKeys,
  onToggleTaskGroup,
}: SidebarRowContentProps) {
  if (row.kind === 'task-group-toggle') {
    return (
      <div className="min-w-0 overflow-hidden">
        <SidebarTaskGroupToggle
          expanded={row.expanded}
          hiddenCount={row.hiddenCount}
          rowVariant={row.rowVariant}
          onToggle={() => onToggleTaskGroup(row.groupId)}
        />
      </div>
    );
  }

  const dndId = rowToDndId(row);
  if (row.kind === 'group') {
    return (
      <div data-sidebar-row={dndId} className="min-w-0 overflow-hidden">
        <SidebarGroupHeader group={row.group} />
      </div>
    );
  }

  if (row.kind === 'project') {
    const isDropTarget = dropTargetProjectId === row.projectId;
    if (!dndEnabled) {
      return (
        <div data-sidebar-row={dndId} className="min-w-0 overflow-hidden">
          <SidebarProjectItem projectId={row.projectId} isDropTarget={isDropTarget} />
        </div>
      );
    }
    return (
      <SortableRow dndId={dndId}>
        <SidebarProjectItem projectId={row.projectId} isDropTarget={isDropTarget} />
      </SortableRow>
    );
  }

  // While dragging, the in-list ghost row previews the projected depth so the
  // user sees where the task would nest on drop.
  const isDragGhost = activeId === dndId && taskProjection !== null;
  const taskNode = (
    <SidebarTaskItem
      projectId={row.projectId}
      taskId={row.taskId}
      rowVariant={row.showProjectTag ? 'flat' : 'underProject'}
      depth={isDragGhost ? taskProjection.depth : row.depth}
      childCount={row.childCount}
      treeTrail={isDragGhost ? undefined : row.treeTrail}
      isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(row.projectId, row.taskId))}
    />
  );
  if (!dndEnabled) {
    return (
      <ConversationTaskDropRow
        projectId={row.projectId}
        taskId={row.taskId}
        data-sidebar-row={dndId}
      >
        {taskNode}
      </ConversationTaskDropRow>
    );
  }
  return (
    <SortableRow dndId={dndId} projectId={row.projectId} taskId={row.taskId}>
      {taskNode}
    </SortableRow>
  );
});

/**
 * Drop the descendant subtree of the dragged task (rows immediately following
 * it with a greater depth) — it travels with the task and must not be a drop
 * target.
 */
function filterTaskDescendantRows(
  rows: SidebarRow[],
  projectId: string,
  taskId: string
): SidebarRow[] {
  const result: SidebarRow[] = [];
  let skipDeeperThan: number | null = null;
  for (const row of rows) {
    if (row.kind === 'task' && row.projectId === projectId) {
      const depth = row.depth ?? 0;
      if (skipDeeperThan !== null && depth > skipDeeperThan) continue;
      skipDeeperThan = row.taskId === taskId ? depth : null;
    } else {
      skipDeeperThan = null;
    }
    result.push(row);
  }
  return result;
}

function rowToDndId(row: SidebarRow): string {
  if (row.kind === 'project') return toProjectDndId(row.projectId);
  if (row.kind === 'group') return toGroupDndId(row.group);
  return toTaskDndId(row.projectId, row.taskId);
}

function getActiveSidebarDndId(
  currentView: string,
  taskProjectId?: string,
  taskId?: string,
  projectId?: string
): string | null {
  if (currentView === 'task' && taskProjectId && taskId) {
    return toTaskDndId(taskProjectId, taskId);
  }
  if (currentView === 'project' && projectId) {
    return toProjectDndId(projectId);
  }
  return null;
}

function limitTaskGroupRows(
  rows: SidebarRow[],
  expandedTaskGroupIds: ReadonlySet<string>,
  visibleLimit: number
) {
  const limitedRows: SidebarRenderableRow[] = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    limitedRows.push(row);
    index += 1;

    if (row.kind === 'project') {
      const taskRows = takeProjectTaskRows(rows, index, row.projectId);
      appendLimitedTaskRows(
        limitedRows,
        taskRows.rows,
        toProjectTaskGroupId(row.projectId),
        expandedTaskGroupIds,
        'underProject',
        visibleLimit
      );
      index = taskRows.nextIndex;
      continue;
    }

    if (row.kind !== 'group') continue;

    const taskRows = takeDirectTaskRows(rows, index);
    appendLimitedTaskRows(
      limitedRows,
      taskRows.rows,
      toDirectTaskGroupId(row.group),
      expandedTaskGroupIds,
      'flat',
      visibleLimit
    );
    index = taskRows.nextIndex;
  }

  return limitedRows;
}

function appendLimitedTaskRows(
  target: SidebarRenderableRow[],
  taskRows: Extract<SidebarRow, { kind: 'task' }>[],
  groupId: string,
  expandedTaskGroupIds: ReadonlySet<string>,
  rowVariant: SidebarTaskGroupToggleRow['rowVariant'],
  visibleLimit: number
) {
  if (taskRows.length === 0) return;

  const expanded = expandedTaskGroupIds.has(groupId);
  const { visibleItems, hiddenCount } = getSidebarTaskGroupDisclosure(
    taskRows,
    expanded,
    visibleLimit
  );
  target.push(...visibleItems);
  if (hiddenCount > 0) {
    target.push({
      kind: 'task-group-toggle',
      groupId,
      hiddenCount,
      expanded,
      rowVariant,
    });
  }
}

function takeProjectTaskRows(rows: SidebarRow[], startIndex: number, projectId: string) {
  const taskRows: Extract<SidebarRow, { kind: 'task' }>[] = [];
  let nextIndex = startIndex;

  while (nextIndex < rows.length) {
    const row = rows[nextIndex];
    if (row.kind !== 'task' || row.projectId !== projectId || row.showProjectTag) break;
    taskRows.push(row);
    nextIndex += 1;
  }

  return { rows: taskRows, nextIndex };
}

function takeDirectTaskRows(rows: SidebarRow[], startIndex: number) {
  const taskRows: Extract<SidebarRow, { kind: 'task' }>[] = [];
  let nextIndex = startIndex;

  while (nextIndex < rows.length) {
    const row = rows[nextIndex];
    if (row.kind !== 'task') break;
    taskRows.push(row);
    nextIndex += 1;
  }

  return { rows: taskRows, nextIndex };
}

function findHiddenTaskGroupId(
  rows: SidebarRow[],
  expandedTaskGroupIds: ReadonlySet<string>,
  targetDndId: string,
  visibleLimit: number
) {
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    index += 1;

    if (row.kind === 'project') {
      const groupId = toProjectTaskGroupId(row.projectId);
      const taskRows = takeProjectTaskRows(rows, index, row.projectId);
      if (
        !expandedTaskGroupIds.has(groupId) &&
        hiddenTaskRowsContain(taskRows.rows, targetDndId, visibleLimit)
      ) {
        return groupId;
      }
      index = taskRows.nextIndex;
      continue;
    }

    if (row.kind !== 'group') continue;

    const groupId = toDirectTaskGroupId(row.group);
    const taskRows = takeDirectTaskRows(rows, index);
    if (
      !expandedTaskGroupIds.has(groupId) &&
      hiddenTaskRowsContain(taskRows.rows, targetDndId, visibleLimit)
    ) {
      return groupId;
    }
    index = taskRows.nextIndex;
  }

  return null;
}

function hiddenTaskRowsContain(
  rows: Extract<SidebarRow, { kind: 'task' }>[],
  targetDndId: string,
  visibleLimit: number
) {
  return hiddenSidebarTaskGroupItemsContain(
    rows,
    (row) => rowToDndId(row) === targetDndId,
    visibleLimit
  );
}

function SidebarGroupHeader({ group }: { group: SidebarGroupKey }) {
  const { t } = useTranslation();
  const label =
    group.kind === 'type'
      ? group.type === 'local'
        ? t('sidebar.filterLocal')
        : t('sidebar.filterSsh')
      : t(`sidebar.activityBucket.${group.bucket}`);
  return (
    <div className="flex h-8 items-center px-2 text-xs font-medium uppercase tracking-wide text-foreground-tertiary-muted select-none">
      {label}
    </div>
  );
}

interface SortableRowProps {
  dndId: string;
  children: React.ReactNode;
  projectId?: string;
  taskId?: string;
}

/**
 * The sortable transform must live on the OUTERMOST row element: nesting it
 * inside an `overflow-hidden` wrapper clips the row away as soon as dnd-kit
 * translates it (make-way animation), making passed-over rows invisible. This
 * row therefore carries `data-sidebar-row` itself — no extra wrapper.
 */
function SortableRow({ dndId, children, projectId, taskId }: SortableRowProps) {
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({
    id: dndId,
  });
  const { dropRef, isOver } = useConversationTaskDropZone(projectId, taskId);
  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      dropRef(projectId && taskId ? node : null);
    },
    [dropRef, projectId, setNodeRef, taskId]
  );

  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 'auto',
  };

  return (
    <div
      ref={setRowRef}
      style={dndStyle}
      data-sidebar-row={dndId}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg',
        isOver && 'ring-2 ring-inset ring-primary bg-primary/10'
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function useConversationTaskDropZone(projectId?: string, taskId?: string) {
  return useTabDropZone({
    canDrop: (payload) => {
      if (!projectId || !taskId || !getRegisteredTaskData(projectId, taskId)) return false;
      return canMoveConversationToTask(payload, projectId, taskId);
    },
    onDrop: (payload: TabDragPayload, _event: TabDropEvent) => {
      if (!projectId || !taskId) return;
      const transfer = conversationTransferFromPayload(payload);
      if (!transfer) return;
      const taskName = getRegisteredTaskData(projectId, taskId)?.name ?? taskId;
      void moveConversationToTask({
        projectId,
        sourceTaskId: transfer.sourceTaskId,
        targetTaskId: taskId,
        targetTaskName: taskName,
        conversationId: transfer.conversationId,
      });
    },
  });
}

function ConversationTaskDropRow({
  projectId,
  taskId,
  children,
  ...props
}: {
  projectId: string;
  taskId: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { dropRef, isOver } = useConversationTaskDropZone(projectId, taskId);
  return (
    <div
      {...props}
      ref={dropRef}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg',
        isOver && 'ring-2 ring-inset ring-primary bg-primary/10'
      )}
    >
      {children}
    </div>
  );
}
