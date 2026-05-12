import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { sidebarStore } from '@renderer/lib/stores/app-state';
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
        <SidebarMenu className="px-3">
          {entries.map(({ projectId, taskId }) => (
            <SidebarTaskItem
              key={`${projectId}:${taskId}`}
              projectId={projectId}
              taskId={taskId}
              rowVariant="pinned"
            />
          ))}
        </SidebarMenu>
      )}
    </SidebarGroup>
  );
});
