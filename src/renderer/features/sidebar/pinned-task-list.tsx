import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { SidebarProjectItem } from './project-item';
import { SidebarGroup, SidebarMenu, SidebarSectionHeader } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const { t } = useTranslation();
  const entries = sidebarStore.pinnedSidebarEntries;
  const collapsed = sidebarStore.pinnedCollapsed;
  const showList = !collapsed && entries.length > 0;

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
          {entries.map((entry) => {
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
              />
            );
          })}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
});
