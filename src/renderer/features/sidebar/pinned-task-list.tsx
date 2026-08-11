import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import {
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
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import {
  findHiddenPinnedTaskGroupId,
  limitPinnedTaskListRows,
  type PinnedTaskListRow,
} from './pinned-task-list-model';
import { SidebarProjectItem } from './project-item';
import { SidebarGroup, SidebarMenu, SidebarSectionHeader } from './sidebar-primitives';
import { SidebarTaskGroupToggle } from './sidebar-task-group-toggle';
import { getSidebarVirtualRowOffset } from './sidebar-virtual-list-layout';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList({
  scrollElementRef,
}: {
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const entries = sidebarStore.pinnedSidebarEntries;
  const teamRoomTaskKeys = useTeamRoomTaskKeys();
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');
  const collapsed = sidebarStore.pinnedCollapsed;
  const showList = !collapsed && entries.length > 0;
  const taskGroupVisibleLimit = sidebarStore.taskGroupVisibleLimit;
  const listContainerRef = useRef<HTMLDivElement>(null);
  const previousRowCountRef = useRef<number | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const activeProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const activeTaskId = currentView === 'task' ? taskParams.taskId : undefined;
  const activeTaskKey =
    activeProjectId && activeTaskId ? `${activeProjectId}::${activeTaskId}` : null;
  const autoExpandedActiveTaskKeyRef = useRef<string | null>(null);
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(
    () => limitPinnedTaskListRows(entries, expandedTaskGroupIds, taskGroupVisibleLimit),
    [entries, expandedTaskGroupIds, taskGroupVisibleLimit]
  );

  const virtualizer = useVirtualizer({
    count: showList ? rows.length : 0,
    getScrollElement: () => scrollElementRef.current,
    // This list shares the sidebar scroll root with the projects list. Let
    // scroll input yield to the browser instead of forcing a sync commit.
    useFlushSync: false,
    estimateSize: () => 32,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => {
      const row = rows[index];
      return row ? pinnedRowKey(row) : index;
    },
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Pinned task rows can be inserted while their project is already visible.
  // Re-measure the structural change before paint so the shared scroll root
  // does not keep the old project-only viewport for one extra interaction.
  const virtualRowCount = showList ? rows.length : 0;
  useLayoutEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = virtualRowCount;
    if (previousRowCount === null || previousRowCount === virtualRowCount) return;
    virtualizer.measure();
  }, [virtualRowCount, virtualizer]);

  // The section header sits above this list, so virtual rows need the same
  // scroll-root coordinate adjustment as the projects list. The margin only
  // depends on layout, not on individual task updates.
  useLayoutEffect(() => {
    if (!showList) {
      setScrollMargin(0);
      return;
    }
    const list = listContainerRef.current;
    const scrollElement = scrollElementRef.current;
    if (!list || !scrollElement) return;

    const updateScrollMargin = () => {
      const nextMargin = Math.max(
        0,
        list.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop
      );
      setScrollMargin((current) => (current === nextMargin ? current : nextMargin));
    };

    updateScrollMargin();
    const observer = new ResizeObserver(updateScrollMargin);
    observer.observe(list);
    observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElementRef, showList]);

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

  const activeRowIndex = useMemo(
    () =>
      rows.findIndex((row) => {
        if (!activeProjectId) return false;
        if (row.kind === 'task-group-toggle') return false;
        if (row.projectId !== activeProjectId) return false;
        return activeTaskId
          ? 'taskId' in row && row.taskId === activeTaskId
          : row.kind === 'project';
      }),
    [activeProjectId, activeTaskId, rows]
  );

  useEffect(() => {
    if (activeRowIndex < 0) return;
    virtualizer.scrollToIndex(activeRowIndex, { align: 'auto' });
  }, [activeRowIndex, virtualizer]);

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
          <div
            ref={listContainerRef}
            className="relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                className="min-w-0 overflow-hidden"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${getSidebarVirtualRowOffset(virtualItem.start, scrollMargin)}px)`,
                }}
              >
                <PinnedRowContent
                  row={rows[virtualItem.index]!}
                  teamRoomTaskKeys={teamRoomTaskKeys}
                  onToggleTaskGroup={toggleTaskGroupExpanded}
                />
              </div>
            ))}
          </div>
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
});

type PinnedRowContentProps = {
  row: PinnedTaskListRow;
  teamRoomTaskKeys: ReadonlySet<string>;
  onToggleTaskGroup: (groupId: string) => void;
};

// The virtualizer updates its parent on every scroll frame. Keep task/project
// observers out of that render path when the pinned row model is unchanged.
const PinnedRowContent = memo(function PinnedRowContent({
  row,
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
    return <SidebarProjectItem projectId={row.projectId} />;
  }
  return (
    <SidebarTaskItem
      projectId={row.projectId}
      taskId={row.taskId}
      rowVariant={row.kind === 'project-task' ? 'underProject' : 'pinned'}
      isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(row.projectId, row.taskId))}
    />
  );
});

function pinnedRowKey(row: PinnedTaskListRow): string {
  if (row.kind === 'task-group-toggle') return `toggle:${row.groupId}`;
  return `${row.kind}:${row.projectId}:${'taskId' in row ? row.taskId : ''}`;
}
