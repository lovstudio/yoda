import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { observer } from 'mobx-react-lite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
import { useMoveTaskToProject } from '@renderer/features/tasks/components/use-move-task-to-project';
import {
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { SidebarProjectItem } from './project-item';
import { isSidebarDndDropAllowed, normalizeSidebarDndId } from './sidebar-dnd-ids';
import { type SidebarRow } from './sidebar-store';
import {
  getTreeProjection,
  projectedSiblingOrder,
  withParents,
  type TreeFlatRow,
  type TreeProjection,
} from './sidebar-tree-projection';
import { SidebarTaskItem } from './task-item';

type SidebarDndContextValue = {
  activeId: string | null;
  dndEnabled: boolean;
  dropTargetProjectId: string | null;
  taskProjection: TreeProjection | null;
};

const SidebarDndContext = createContext<SidebarDndContextValue | null>(null);

export const SidebarDndProvider = observer(function SidebarDndProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const teamRoomTaskKeys = useTeamRoomTaskKeys();
  const rows = sidebarStore.sidebarRows;
  const dndEnabled = sidebarStore.taskGroupBy === 'project';
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskProjection, setTaskProjection] = useState<TreeProjection | null>(null);
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const moveTaskToProject = useMoveTaskToProject();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const draggingTask = parseTaskDndId(activeId);
  const dragTreeRows = useMemo(
    () => (draggingTask ? getDragTreeRows(rows, draggingTask) : null),
    [draggingTask, rows]
  );

  const clearDragState = useCallback(() => {
    setActiveId(null);
    setTaskProjection(null);
    setDropTargetProjectId(null);
  }, []);

  // dnd-kit normally emits drag end/cancel, but a pointer can finish while
  // Electron changes focus (for example when a native menu or DevTools opens).
  // Keep the renderer's derived drag state from outliving the underlying drag.
  useEffect(() => {
    if (!activeId) return;

    const clearOnVisibilityChange = () => {
      if (document.visibilityState === 'hidden') clearDragState();
    };

    window.addEventListener('pointerup', clearDragState, true);
    window.addEventListener('pointercancel', clearDragState, true);
    window.addEventListener('blur', clearDragState);
    document.addEventListener('visibilitychange', clearOnVisibilityChange);
    return () => {
      window.removeEventListener('pointerup', clearDragState, true);
      window.removeEventListener('pointercancel', clearDragState, true);
      window.removeEventListener('blur', clearDragState);
      document.removeEventListener('visibilitychange', clearOnVisibilityChange);
    };
  }, [activeId, clearDragState]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const nextId = normalizeSidebarDndId(String(event.active.id));
    if (!nextId.startsWith('proj::') && !nextId.startsWith('task::')) return;
    setActiveId(nextId);
    setTaskProjection(null);
    setDropTargetProjectId(null);
  }, []);

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      const currentDraggingTask = parseTaskDndId(normalizeSidebarDndId(String(event.active.id)));
      if (!currentDraggingTask) return;

      const overId = event.over ? normalizeSidebarDndId(String(event.over.id)) : null;
      if (overId && overId.startsWith('proj::')) {
        const projectId = overId.slice('proj::'.length);
        setDropTargetProjectId(projectId !== currentDraggingTask.projectId ? projectId : null);
        setTaskProjection(null);
        return;
      }

      setDropTargetProjectId(null);
      if (!dragTreeRows || !overId || !overId.startsWith('task::')) {
        setTaskProjection(null);
        return;
      }

      const overTask = parseTaskDndId(overId);
      if (!overTask || overTask.projectId !== currentDraggingTask.projectId) {
        setTaskProjection(null);
        return;
      }

      setTaskProjection(
        getTreeProjection(dragTreeRows, currentDraggingTask.taskId, overTask.taskId, event.delta.x)
      );
    },
    [dragTreeRows]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeDndId = normalizeSidebarDndId(String(event.active.id));
      const overId = event.over ? normalizeSidebarDndId(String(event.over.id)) : null;
      const currentDraggingTask = parseTaskDndId(activeDndId);
      const currentDragTreeRows = currentDraggingTask
        ? getDragTreeRows(sidebarStore.sidebarRows, currentDraggingTask)
        : null;

      clearDragState();
      if (!overId) return;

      if (currentDraggingTask && overId.startsWith('proj::')) {
        const targetProjectId = overId.slice('proj::'.length);
        if (targetProjectId !== currentDraggingTask.projectId) {
          moveTaskToProject(
            currentDraggingTask.projectId,
            currentDraggingTask.taskId,
            targetProjectId,
            null
          );
        }
        return;
      }

      if (activeDndId.startsWith('proj::') && overId.startsWith('proj::')) {
        if (activeDndId === overId) return;
        const ids = sidebarStore.orderedProjects
          .map((project) =>
            project.state === 'unregistered' ? project.id : (project.data?.id ?? '')
          )
          .filter(Boolean);
        const oldIndex = ids.indexOf(activeDndId.slice('proj::'.length));
        const newIndex = ids.indexOf(overId.slice('proj::'.length));
        if (oldIndex !== -1 && newIndex !== -1) {
          sidebarStore.setProjectOrder(arrayMove(ids, oldIndex, newIndex));
        }
        return;
      }

      if (!currentDraggingTask || !overId.startsWith('task::') || !currentDragTreeRows) {
        return;
      }

      const overTask = parseTaskDndId(overId);
      if (!overTask) return;

      if (overTask.projectId !== currentDraggingTask.projectId) {
        moveTaskToProject(
          currentDraggingTask.projectId,
          currentDraggingTask.taskId,
          overTask.projectId,
          overTask.taskId
        );
        return;
      }

      const projection = getTreeProjection(
        currentDragTreeRows,
        currentDraggingTask.taskId,
        overTask.taskId,
        event.delta.x
      );
      if (!projection) return;

      const newParentId = projection.parentTaskId;
      const order = projectedSiblingOrder(
        currentDragTreeRows,
        currentDraggingTask.taskId,
        overTask.taskId,
        newParentId
      );
      const currentParentId =
        getRegisteredTaskData(currentDraggingTask.projectId, currentDraggingTask.taskId)
          ?.parentTaskId ?? null;

      if (newParentId !== currentParentId) {
        const taskStore = getTaskStore(currentDraggingTask.projectId, currentDraggingTask.taskId);
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
        sidebarStore.setTaskOrder(currentDraggingTask.projectId, order);
      }
    },
    [clearDragState, moveTaskToProject, t]
  );

  const contextValue = useMemo(
    () => ({ activeId, dndEnabled, dropTargetProjectId, taskProjection }),
    [activeId, dndEnabled, dropTargetProjectId, taskProjection]
  );

  return (
    <SidebarDndContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={typeRestrictedCollision}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragState}
      >
        {children}
        <DragOverlay>
          {activeId ? (
            <div className="px-3">
              <div className="rounded-lg bg-background-tertiary-2 shadow-md">
                {renderOverlayContent(activeId, teamRoomTaskKeys)}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </SidebarDndContext.Provider>
  );
});

export function useSidebarDnd(): SidebarDndContextValue {
  const context = useContext(SidebarDndContext);
  if (!context) {
    throw new Error('useSidebarDnd must be used within SidebarDndProvider');
  }
  return context;
}

function parseTaskDndId(dndId: string | null): { projectId: string; taskId: string } | null {
  if (!dndId?.startsWith('task::')) return null;
  const [, projectId, taskId] = dndId.split('::');
  if (!projectId || !taskId) return null;
  return { projectId, taskId };
}

function getDragTreeRows(
  rows: SidebarRow[],
  draggingTask: { projectId: string; taskId: string }
): TreeFlatRow[] {
  return withParents(
    filterTaskDescendantRows(rows, draggingTask.projectId, draggingTask.taskId)
      .filter(
        (row): row is Extract<SidebarRow, { kind: 'task' }> =>
          row.kind === 'task' && row.projectId === draggingTask.projectId && !row.showProjectTag
      )
      .map((row) => ({ taskId: row.taskId, depth: row.depth ?? 0 }))
  );
}

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

function renderOverlayContent(id: string, teamRoomTaskKeys: ReadonlySet<string>) {
  if (id.startsWith('proj::')) {
    return <SidebarProjectItem projectId={id.slice('proj::'.length)} />;
  }
  if (id.startsWith('task::')) {
    const [, projectId, taskId] = id.split('::');
    return (
      <SidebarTaskItem
        projectId={projectId}
        taskId={taskId}
        isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(projectId, taskId))}
        disableHoverPreview
      />
    );
  }
  return null;
}

// A project drags only onto other projects (reorder). A task drags onto any task
// (same-project reparent or cross-project move-and-nest) OR onto any OTHER
// project row (cross-project move to root). Restricting the droppable set keeps
// drags that can't resolve in onDragEnd from silently no-op'ing.
const typeRestrictedCollision: CollisionDetection = (args) => {
  const activeId = normalizeSidebarDndId(String(args.active.id));
  const droppableContainers = args.droppableContainers.filter((container) =>
    isSidebarDndDropAllowed(activeId, String(container.id))
  );

  const pointerMatches = pointerWithin({ ...args, droppableContainers });
  if (pointerMatches.length > 0) return pointerMatches;

  return closestCenter({ ...args, droppableContainers });
};
