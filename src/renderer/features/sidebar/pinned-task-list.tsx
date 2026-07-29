import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  teamRoomTaskKey,
  useTeamRoomTaskKeys,
} from '@renderer/features/agent-room/team-room-queries';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { findHiddenPinnedTaskGroupId, limitPinnedTaskListRows } from './pinned-task-list-model';
import { SidebarProjectItem } from './project-item';
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
  const activeTaskKey =
    taskParams.projectId && taskParams.taskId
      ? `${taskParams.projectId}::${taskParams.taskId}`
      : null;
  const autoExpandedActiveTaskKeyRef = useRef<string | null>(null);
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Set<string>>(() => new Set());
  const rows = useMemo(
    () => limitPinnedTaskListRows(entries, expandedTaskGroupIds),
    [entries, expandedTaskGroupIds]
  );

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
      taskParams.taskId
    );
    if (!hiddenGroupId) return;

    autoExpandedActiveTaskKeyRef.current = activeTaskKey;
    setExpandedTaskGroupIds((previous) => {
      if (previous.has(hiddenGroupId)) return previous;
      const next = new Set(previous);
      next.add(hiddenGroupId);
      return next;
    });
  }, [activeTaskKey, entries, expandedTaskGroupIds, taskParams.projectId, taskParams.taskId]);

  function toggleTaskGroupExpanded(groupId: string): void {
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
  }

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
          {rows.map((entry) => {
            if (entry.kind === 'task-group-toggle') {
              return (
                <div key={`toggle:${entry.groupId}`} className="min-w-0 overflow-hidden">
                  <SidebarTaskGroupToggle
                    expanded={entry.expanded}
                    hiddenCount={entry.hiddenCount}
                    rowVariant={entry.rowVariant}
                    onToggle={() => toggleTaskGroupExpanded(entry.groupId)}
                  />
                </div>
              );
            }
            if (entry.kind === 'project') {
              return (
                <SidebarProjectItem
                  key={`project:${entry.projectId}`}
                  projectId={entry.projectId}
                />
              );
            }
            return (
              <SidebarTaskItem
                key={`${entry.kind}:${entry.projectId}:${entry.taskId}`}
                projectId={entry.projectId}
                taskId={entry.taskId}
                rowVariant={entry.kind === 'project-task' ? 'underProject' : 'pinned'}
                isMultiAgent={teamRoomTaskKeys.has(teamRoomTaskKey(entry.projectId, entry.taskId))}
              />
            );
          })}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
});
