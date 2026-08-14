import { useDraggable, useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { cn } from '@renderer/utils/utils';
import {
  findHiddenPinnedTaskGroupId,
  limitPinnedTaskListRows,
  type PinnedTaskListRow,
} from './pinned-task-list-model';
import { SidebarProjectItem } from './project-item';
import { useSidebarDnd } from './sidebar-dnd-context';
import { toSidebarPinnedDndId } from './sidebar-dnd-ids';
import { SidebarGroup, SidebarMenu, SidebarSectionHeader } from './sidebar-primitives';
import { SIDEBAR_TASK_GROUP_REVEAL_INCREMENT } from './sidebar-task-group';
import { SidebarTaskGroupToggle } from './sidebar-task-group-toggle';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const { t } = useTranslation();
  const entries = sidebarStore.pinnedSidebarEntries;
  const { params: taskParams } = useParams('task');
  const collapsed = sidebarStore.pinnedCollapsed;
  const showList = !collapsed && entries.length > 0;
  const taskGroupVisibleLimit = sidebarStore.taskGroupVisibleLimit;
  const activeTaskKey =
    taskParams.projectId && taskParams.taskId
      ? `${taskParams.projectId}::${taskParams.taskId}`
      : null;
  const autoExpandedActiveTaskKeyRef = useRef<string | null>(null);
  const [visibleTaskCountByGroupId, setVisibleTaskCountByGroupId] = useState<Map<string, number>>(
    () => new Map()
  );
  const rows = useMemo(
    () => limitPinnedTaskListRows(entries, visibleTaskCountByGroupId, taskGroupVisibleLimit),
    [entries, taskGroupVisibleLimit, visibleTaskCountByGroupId]
  );
  const { dndEnabled } = useSidebarDnd();

  useEffect(() => {
    if (!activeTaskKey || !taskParams.projectId || !taskParams.taskId) {
      autoExpandedActiveTaskKeyRef.current = null;
      return;
    }
    if (autoExpandedActiveTaskKeyRef.current === activeTaskKey) return;

    const hiddenGroup = findHiddenPinnedTaskGroupId(
      entries,
      visibleTaskCountByGroupId,
      taskParams.projectId,
      taskParams.taskId,
      taskGroupVisibleLimit
    );
    if (!hiddenGroup) return;

    autoExpandedActiveTaskKeyRef.current = activeTaskKey;
    setVisibleTaskCountByGroupId((previous) => {
      if (
        (previous.get(hiddenGroup.groupId) ?? taskGroupVisibleLimit) >= hiddenGroup.visibleCount
      ) {
        return previous;
      }
      const next = new Map(previous);
      next.set(hiddenGroup.groupId, hiddenGroup.visibleCount);
      return next;
    });
  }, [
    activeTaskKey,
    entries,
    taskGroupVisibleLimit,
    taskParams.projectId,
    taskParams.taskId,
    visibleTaskCountByGroupId,
  ]);

  const revealMoreTaskGroupItems = useCallback(
    (groupId: string): void => {
      setVisibleTaskCountByGroupId((previous) => {
        const next = new Map(previous);
        const visibleCount = previous.get(groupId) ?? taskGroupVisibleLimit;
        next.set(groupId, visibleCount + SIDEBAR_TASK_GROUP_REVEAL_INCREMENT);
        return next;
      });
    },
    [taskGroupVisibleLimit]
  );

  return (
    <SidebarGroup className="shrink-0 flex flex-col mb-0">
      <SidebarSectionHeader
        label={t('sidebar.pinned')}
        collapsed={collapsed}
        onToggle={() => sidebarStore.togglePinnedCollapsed()}
      />
      {showList && (
        // Same deferred-reflow hold as the projects list: needsReview demotion
        // stays frozen while the pointer is over these rows.
        <SidebarMenu
          className="px-3"
          onPointerEnter={() => sidebarStore.holdTaskReflow('pinned-list')}
          onPointerLeave={() => sidebarStore.releaseTaskReflow('pinned-list')}
        >
          {rows.map((row) => (
            <div key={pinnedRowKey(row)} className="min-w-0 overflow-hidden">
              <PinnedRowContent
                row={row}
                dndEnabled={dndEnabled}
                onToggleTaskGroup={revealMoreTaskGroupItems}
              />
            </div>
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
});

type PinnedRowContentProps = {
  row: PinnedTaskListRow;
  dndEnabled: boolean;
  onToggleTaskGroup: (groupId: string) => void;
};

// Keep task/project observers out of the pinned list reconciliation when the
// row model is unchanged.
export const PinnedRowContent = memo(function PinnedRowContent({
  row,
  dndEnabled,
  onToggleTaskGroup,
}: PinnedRowContentProps) {
  if (row.kind === 'task-group-toggle') {
    return (
      <SidebarTaskGroupToggle
        hiddenCount={row.hiddenCount}
        rowVariant={row.rowVariant}
        onToggle={() => onToggleTaskGroup(row.groupId)}
      />
    );
  }
  if (row.kind === 'project') {
    return (
      <PinnedDraggableRow dndEnabled={dndEnabled} dndId={`proj::${row.projectId}`}>
        <SidebarProjectItem projectId={row.projectId} />
      </PinnedDraggableRow>
    );
  }
  return (
    <PinnedDraggableRow dndEnabled={dndEnabled} dndId={`task::${row.projectId}::${row.taskId}`}>
      <SidebarTaskItem
        projectId={row.projectId}
        taskId={row.taskId}
        rowVariant={row.kind === 'project-task' ? 'underProject' : 'pinned'}
      />
    </PinnedDraggableRow>
  );
});

function PinnedDraggableRow({
  dndEnabled,
  dndId,
  children,
}: {
  dndEnabled: boolean;
  dndId: string;
  children: ReactNode;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef: setDraggableNodeRef,
  } = useDraggable({
    id: toSidebarPinnedDndId(dndId),
    disabled: !dndEnabled,
  });
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: toSidebarPinnedDndId(dndId),
    disabled: !dndEnabled,
  });
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    [setDraggableNodeRef, setDroppableNodeRef]
  );

  return (
    <div
      ref={setNodeRef}
      data-sidebar-dnd-id={dndId}
      data-sidebar-row={dndId}
      className={cn(
        'min-w-0 overflow-hidden rounded-lg',
        isDragging && 'opacity-40',
        isOver && 'ring-2 ring-inset ring-primary bg-primary/10'
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function pinnedRowKey(row: PinnedTaskListRow): string {
  if (row.kind === 'task-group-toggle') return `toggle:${row.groupId}`;
  return `${row.kind}:${row.projectId}:${'taskId' in row ? row.taskId : ''}`;
}
