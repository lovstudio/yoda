import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTabDropZone, type TabDragPayload, type TabDropEvent } from '@renderer/app/tab-drag';
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
import { type SidebarGroupKey, type SidebarRow } from '@renderer/features/sidebar/sidebar-store';
import { useMoveTaskToProject } from '@renderer/features/tasks/components/use-move-task-to-project';
import {
  canMoveConversationToTask,
  conversationTransferFromPayload,
} from '@renderer/features/tasks/conversations/conversation-transfer';
import { moveConversationToTask } from '@renderer/features/tasks/conversations/move-conversation-to-task';
import {
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import { SidebarProjectItem } from './project-item';
import {
  getTreeProjection,
  projectedSiblingOrder,
  withParents,
  type TreeFlatRow,
  type TreeProjection,
} from './sidebar-tree-projection';
import { SidebarTaskItem } from './task-item';

const TASK_GROUP_VISIBLE_LIMIT = 5;

export const SidebarVirtualList = observer(function SidebarVirtualList() {
  const { t } = useTranslation();
  const rows = sidebarStore.sidebarRows;
  const teamRoomTaskKeys = useTeamRoomTaskKeys();
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const containerRef = useRef<HTMLDivElement>(null);
  const autoExpandedActiveIdRef = useRef<string | null>(null);
  // Last dndId we scrolled into view; gates the reveal effect so it fires on
  // navigation / first mount but not on every background row refresh.
  const lastScrolledTargetRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskProjection, setTaskProjection] = useState<TreeProjection | null>(null);
  // Project a task is hovering over for a cross-project move (null = none).
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Set<string>>(() => new Set());
  const moveTaskToProject = useMoveTaskToProject();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
  // Flat depth-annotated task rows of the dragged task's project, parents
  // derived from the flatten order — the input to the drop projection.
  const dragTreeRows: TreeFlatRow[] | null = draggingTask
    ? withParents(
        displayRows
          .filter(
            (r): r is Extract<SidebarRow, { kind: 'task' }> =>
              r.kind === 'task' && r.projectId === draggingTask.projectId && !r.showProjectTag
          )
          .map((r) => ({ taskId: r.taskId, depth: r.depth ?? 0 }))
      )
    : null;
  const renderRows = useMemo(
    () => limitTaskGroupRows(displayRows, expandedTaskGroupIds),
    [displayRows, expandedTaskGroupIds]
  );

  const dndEnabled = sidebarStore.taskGroupBy === 'project';
  const allDndIds = renderRows.filter(isSidebarRow).map(rowToDndId);
  const activeSidebarDndId = getActiveSidebarDndId(
    currentView,
    taskParams.projectId,
    taskParams.taskId,
    projectParams.projectId
  );

  // Deferred reflow: keep needsReview demotion frozen while the pointer is
  // inside the list, so marking a task (or auto-clear on open) doesn't reorder
  // rows under the cursor. Release on leave/unmount lets the list reflow.
  useEffect(() => () => sidebarStore.releaseTaskReflow('projects-list'), []);

  // Expand the parent project when navigating to a task (not when `rows` changes —
  // otherwise collapsing while staying on that task would immediately re-expand).
  useEffect(() => {
    if (currentView !== 'task') return;
    const targetProjectId = taskParams.projectId;
    const targetTaskId = taskParams.taskId;
    if (!targetProjectId || !targetTaskId) return;
    const activeTask = getTaskStore(targetProjectId, targetTaskId);
    if (activeTask?.data.isPinned) return;
    sidebarStore.ensureProjectExpanded(targetProjectId);
  }, [currentView, taskParams.projectId, taskParams.taskId]);

  // Reveal the active project/task if navigation lands inside a truncated group.
  useEffect(() => {
    if (!activeSidebarDndId) {
      autoExpandedActiveIdRef.current = null;
      return;
    }
    if (currentView === 'task' && taskParams.projectId && taskParams.taskId) {
      const activeTask = getRegisteredTaskData(taskParams.projectId, taskParams.taskId);
      if (activeTask?.archivedAt || activeTask?.archiveRequestedAt) {
        return;
      }
    }
    if (autoExpandedActiveIdRef.current === activeSidebarDndId) return;

    const hiddenGroupId = findHiddenTaskGroupId(
      displayRows,
      expandedTaskGroupIds,
      activeSidebarDndId
    );
    if (!hiddenGroupId) return;

    autoExpandedActiveIdRef.current = activeSidebarDndId;
    setExpandedTaskGroupIds((prev) => {
      if (prev.has(hiddenGroupId)) return prev;
      const next = new Set(prev);
      next.add(hiddenGroupId);
      return next;
    });
  }, [activeSidebarDndId, displayRows, expandedTaskGroupIds]);

  // Scroll the active project/task into view when navigation changes, or when the
  // active row first mounts (e.g. after expanding a truncated group). Guard on the
  // target dndId so background row refreshes (which produce a fresh `renderRows`
  // reference on every store update) don't yank the scroll position back.
  useEffect(() => {
    let targetProjectId: string | null = null;
    let targetTaskId: string | null = null;

    if (currentView === 'task') {
      targetProjectId = taskParams.projectId;
      targetTaskId = taskParams.taskId;
    } else if (currentView === 'project') {
      targetProjectId = projectParams.projectId;
    }

    if (!targetProjectId) {
      lastScrolledTargetRef.current = null;
      return;
    }

    if (targetTaskId) {
      const activeTask = getTaskStore(targetProjectId, targetTaskId);
      if (activeTask?.data.isPinned) {
        return;
      }
    }

    const dndId = targetTaskId
      ? toTaskDndId(targetProjectId, targetTaskId)
      : toProjectDndId(targetProjectId);
    const node = containerRef.current?.querySelector<HTMLElement>(`[data-sidebar-row="${dndId}"]`);
    if (!node) return;
    // Already aligned this target — a re-run here is just a row refresh, not a
    // navigation or a newly-mounted node, so leave the user's scroll alone.
    if (lastScrolledTargetRef.current === dndId) return;
    lastScrolledTargetRef.current = dndId;
    node.scrollIntoView({ block: 'nearest' });
  }, [currentView, taskParams.projectId, taskParams.taskId, projectParams.projectId, renderRows]);

  function toggleTaskGroupExpanded(groupId: string) {
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
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setTaskProjection(null);
    setDropTargetProjectId(null);
  }

  function handleDragMove(event: DragMoveEvent) {
    if (!draggingTask) return;
    const o = event.over ? String(event.over.id) : null;
    // Hovering another project row = a cross-project move target.
    if (o && o.startsWith('proj::')) {
      const projId = o.slice(6);
      setDropTargetProjectId(projId !== draggingTask.projectId ? projId : null);
      setTaskProjection(null);
      return;
    }
    setDropTargetProjectId(null);
    if (!dragTreeRows || !o || !o.startsWith(`task::${draggingTask.projectId}::`)) {
      setTaskProjection(null);
      return;
    }
    const overTaskId = o.split('::')[2];
    setTaskProjection(
      getTreeProjection(dragTreeRows, draggingTask.taskId, overTaskId, event.delta.x)
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setTaskProjection(null);
    setDropTargetProjectId(null);
    const { active, over } = event;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);

    if (a.startsWith('task::') && o.startsWith('proj::')) {
      // Drop a task onto another project row to re-home it there.
      const [, aProjId, aTaskId] = a.split('::');
      const targetProjectId = o.slice(6);
      if (targetProjectId !== aProjId) moveTaskToProject(aProjId, aTaskId, targetProjectId);
      return;
    }

    if (a.startsWith('proj::') && o.startsWith('proj::')) {
      if (a === o) return;
      const ids = sidebarStore.orderedProjects
        .map((p) => (p.state === 'unregistered' ? p.id : (p.data?.id ?? '')))
        .filter(Boolean);
      const oldIdx = ids.indexOf(a.slice(6));
      const newIdx = ids.indexOf(o.slice(6));
      if (oldIdx !== -1 && newIdx !== -1) {
        sidebarStore.setProjectOrder(arrayMove(ids, oldIdx, newIdx));
      }
    } else if (a.startsWith('task::') && o.startsWith('task::')) {
      // Dropping on itself is NOT a no-op here: a pure horizontal move changes
      // the projected depth (indent in = nest under the row above, out = unnest).
      const [, aProjId, aTaskId] = a.split('::');
      const [, oProjId, oTaskId] = o.split('::');
      if (aProjId !== oProjId || !dragTreeRows) return;

      const projection = getTreeProjection(dragTreeRows, aTaskId, oTaskId, event.delta.x);
      if (!projection) return;
      const newParentId = projection.parentTaskId;
      const order = projectedSiblingOrder(dragTreeRows, aTaskId, oTaskId, newParentId);

      const currentParentId = getRegisteredTaskData(aProjId, aTaskId)?.parentTaskId ?? null;
      if (newParentId !== currentParentId) {
        const taskStore = getTaskStore(aProjId, aTaskId);
        void taskStore
          ?.setParentTask(newParentId)
          .then((result) => {
            if (result && !result.success) {
              toast({ title: t('sidebar.setParentFailed'), variant: 'destructive' });
            }
          })
          .catch(() => {
            toast({ title: t('sidebar.setParentFailed'), variant: 'destructive' });
          });
      }
      if (newParentId) {
        sidebarStore.ensureTaskExpanded(newParentId);
        sidebarStore.setChildTaskOrder(newParentId, order);
      } else {
        sidebarStore.setTaskOrder(aProjId, order);
      }
    }
  }

  function renderOverlayContent(id: string) {
    if (id.startsWith('proj::')) {
      return <SidebarProjectItem projectId={id.slice(6)} />;
    }
    if (id.startsWith('task::')) {
      const [, projId, taskId] = id.split('::');
      return (
        <SidebarTaskItem
          projectId={projId}
          taskId={taskId}
          isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(projId, taskId))}
        />
      );
    }
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={typeRestrictedCollision}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allDndIds} strategy={verticalListSortingStrategy}>
        <div
          ref={containerRef}
          className="space-y-0.5 px-3 pt-1 pb-3 overflow-hidden"
          onPointerEnter={() => sidebarStore.holdTaskReflow('projects-list')}
          onPointerLeave={() => sidebarStore.releaseTaskReflow('projects-list')}
        >
          {renderRows.map((row) => {
            if (row.kind === 'task-group-toggle') {
              return (
                <div key={`toggle:${row.groupId}`} className="min-w-0 overflow-hidden">
                  <SidebarTaskGroupToggle
                    row={row}
                    onToggle={() => toggleTaskGroupExpanded(row.groupId)}
                  />
                </div>
              );
            }
            const dndId = rowToDndId(row);
            if (row.kind === 'group') {
              return (
                <div key={dndId} data-sidebar-row={dndId} className="min-w-0 overflow-hidden">
                  <SidebarGroupHeader group={row.group} />
                </div>
              );
            }
            if (row.kind === 'project') {
              const isDropTarget = dropTargetProjectId === row.projectId;
              if (!dndEnabled) {
                return (
                  <div
                    key={row.projectId}
                    data-sidebar-row={dndId}
                    className="min-w-0 overflow-hidden"
                  >
                    <SidebarProjectItem projectId={row.projectId} isDropTarget={isDropTarget} />
                  </div>
                );
              }
              return (
                <SortableRow key={row.projectId} dndId={dndId}>
                  <SidebarProjectItem projectId={row.projectId} isDropTarget={isDropTarget} />
                </SortableRow>
              );
            }
            // While dragging, the in-list ghost row previews the projected
            // depth so the user sees where the task would nest on drop.
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
                  key={`${row.projectId}:${row.taskId}`}
                  projectId={row.projectId}
                  taskId={row.taskId}
                  data-sidebar-row={dndId}
                >
                  {taskNode}
                </ConversationTaskDropRow>
              );
            }
            return (
              <SortableRow
                key={`${row.projectId}:${row.taskId}`}
                dndId={dndId}
                projectId={row.projectId}
                taskId={row.taskId}
              >
                {taskNode}
              </SortableRow>
            );
          })}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeId ? (
          <div className="px-3">
            <div className="rounded-lg bg-background-tertiary-2 shadow-md">
              {renderOverlayContent(activeId)}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

type SidebarTaskGroupToggleRow = {
  kind: 'task-group-toggle';
  groupId: string;
  hiddenCount: number;
  expanded: boolean;
  rowVariant: 'underProject' | 'flat';
};

type SidebarRenderableRow = SidebarRow | SidebarTaskGroupToggleRow;

const toProjectDndId = (id: string) => `proj::${id}`;
const toTaskDndId = (projectId: string, taskId: string) => `task::${projectId}::${taskId}`;
const toGroupDndId = (group: SidebarGroupKey) =>
  group.kind === 'type' ? `group::type::${group.type}` : `group::activity::${group.bucket}`;
const toProjectTaskGroupId = (projectId: string) => `project-tasks::${projectId}`;
const toDirectTaskGroupId = (group: SidebarGroupKey) => `direct-tasks::${toGroupDndId(group)}`;

function isSidebarRow(row: SidebarRenderableRow): row is SidebarRow {
  return row.kind !== 'task-group-toggle';
}

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
    const activeTask = getTaskStore(taskProjectId, taskId);
    if (activeTask?.data.isPinned) return null;
    return toTaskDndId(taskProjectId, taskId);
  }
  if (currentView === 'project' && projectId) {
    return toProjectDndId(projectId);
  }
  return null;
}

function limitTaskGroupRows(rows: SidebarRow[], expandedTaskGroupIds: ReadonlySet<string>) {
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
        'underProject'
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
      'flat'
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
  rowVariant: SidebarTaskGroupToggleRow['rowVariant']
) {
  if (taskRows.length === 0) return;

  const expanded = expandedTaskGroupIds.has(groupId);
  const visibleRows = expanded ? taskRows : taskRows.slice(0, TASK_GROUP_VISIBLE_LIMIT);
  target.push(...visibleRows);

  const hiddenCount = taskRows.length - TASK_GROUP_VISIBLE_LIMIT;
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
  targetDndId: string
) {
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    index += 1;

    if (row.kind === 'project') {
      const groupId = toProjectTaskGroupId(row.projectId);
      const taskRows = takeProjectTaskRows(rows, index, row.projectId);
      if (!expandedTaskGroupIds.has(groupId) && hiddenTaskRowsContain(taskRows.rows, targetDndId)) {
        return groupId;
      }
      index = taskRows.nextIndex;
      continue;
    }

    if (row.kind !== 'group') continue;

    const groupId = toDirectTaskGroupId(row.group);
    const taskRows = takeDirectTaskRows(rows, index);
    if (!expandedTaskGroupIds.has(groupId) && hiddenTaskRowsContain(taskRows.rows, targetDndId)) {
      return groupId;
    }
    index = taskRows.nextIndex;
  }

  return null;
}

function hiddenTaskRowsContain(rows: Extract<SidebarRow, { kind: 'task' }>[], targetDndId: string) {
  return rows.slice(TASK_GROUP_VISIBLE_LIMIT).some((row) => rowToDndId(row) === targetDndId);
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

function SidebarTaskGroupToggle({
  row,
  onToggle,
}: {
  row: SidebarTaskGroupToggleRow;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = row.expanded
    ? t('sidebar.collapseGroupItems')
    : t('sidebar.showMoreGroupItems', { count: row.hiddenCount });

  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg text-left text-xs font-medium text-foreground-tertiary-muted transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        row.rowVariant === 'underProject' ? 'pl-8 pr-2' : 'px-2'
      )}
    >
      <ChevronDown
        className={`size-3.5 shrink-0 transition-transform ${row.expanded ? 'rotate-180' : ''}`}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

// A project drags only onto other projects (reorder). A task drags onto a task
// in its own project (reparent) OR onto any OTHER project row (cross-project
// move). Restricting the droppable set keeps drags that can't resolve in
// onDragEnd from silently no-op'ing.
const typeRestrictedCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const droppableContainers = activeId.startsWith('proj::')
    ? args.droppableContainers.filter((c) => String(c.id).startsWith('proj::'))
    : (() => {
        const sourceProjectId = activeId.split('::')[1];
        const taskPrefix = `task::${sourceProjectId}::`;
        const ownProjectId = `proj::${sourceProjectId}`;
        return args.droppableContainers.filter((c) => {
          const id = String(c.id);
          return id.startsWith(taskPrefix) || (id.startsWith('proj::') && id !== ownProjectId);
        });
      })();
  return closestCenter({ ...args, droppableContainers });
};

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
