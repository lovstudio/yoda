import { useDraggable, useDroppable } from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
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
import { SidebarTaskGroupToggle } from './sidebar-task-group-toggle';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const { t } = useTranslation();
  const entries = sidebarStore.pinnedSidebarEntries;
  const teamRoomTaskKeys = useTeamRoomTaskKeys();
  const { params: taskParams } = useParams('task');
  const collapsed = sidebarStore.pinnedCollapsed;
  const showList = !collapsed && entries.length > 0;
  const taskGroupVisibleLimit = sidebarStore.taskGroupVisibleLimit;
  const activeTaskKey =
    taskParams.projectId && taskParams.taskId
      ? `${taskParams.projectId}::${taskParams.taskId}`
      : null;
  const autoExpandedActiveTaskKeyRef = useRef<string | null>(null);
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(
    () => limitPinnedTaskListRows(entries, expandedTaskGroupIds, taskGroupVisibleLimit),
    [entries, expandedTaskGroupIds, taskGroupVisibleLimit]
  );
  const { dndEnabled } = useSidebarDnd();

  useEffect(() => {
    if (!activeTaskKey || !taskParams.projectId || !taskParams.taskId) {
      autoExpandedActiveTaskKeyRef.current = null;
      return;
    }
    if (autoExpandedActiveTaskKeyRef.current === activeTaskKey) return;

    const hiddenGroupId = findHiddenPinnedTaskGroupId(
      entries,
      expandedTaskGroupIds,
      taskParams.projectId,
      taskParams.taskId,
      taskGroupVisibleLimit
    );
    if (!hiddenGroupId) return;

    autoExpandedActiveTaskKeyRef.current = activeTaskKey;
    setExpandedTaskGroupIds((previous) => {
      if (previous.has(hiddenGroupId)) return previous;
      const next = new Set(previous);
      next.add(hiddenGroupId);
      return next;
    });
  }, [
    activeTaskKey,
    entries,
    expandedTaskGroupIds,
    taskGroupVisibleLimit,
    taskParams.projectId,
    taskParams.taskId,
  ]);

  const toggleTaskGroupExpanded = useCallback(
    (groupId: string): void => {
      setExpandedTaskGroupIds((previous) => {
        const next = new Set(previous);
        if (next.has(groupId)) {
          if (activeTaskKey) {
            autoExpandedActiveTaskKeyRef.current = activeTaskKey;
          }
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    },
    [activeTaskKey]
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
                teamRoomTaskKeys={teamRoomTaskKeys}
                onToggleTaskGroup={toggleTaskGroupExpanded}
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
  teamRoomTaskKeys: ReadonlySet<string>;
  onToggleTaskGroup: (groupId: string) => void;
};

// Keep task/project observers out of the pinned list reconciliation when the
// row model is unchanged.
const PinnedRowContent = memo(function PinnedRowContent({
  row,
  dndEnabled,
  teamRoomTaskKeys,
  onToggleTaskGroup,
}: PinnedRowContentProps) {
  if (row.kind === 'task-group-toggle') {
    return (
      <SidebarTaskGroupToggle
        expanded={row.expanded}
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
        isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(row.projectId, row.taskId))}
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

function pinnedRowKey(row: PinnedTaskListRow): string {
  if (row.kind === 'task-group-toggle') return `toggle:${row.groupId}`;
  return `${row.kind}:${row.projectId}:${'taskId' in row ? row.taskId : ''}`;
}
