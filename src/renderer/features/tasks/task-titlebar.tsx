import { PanelBottom, PanelRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TaskFinishControl } from '@renderer/features/tasks/finish-flow/finish-control';
import { QuickActionSuggestionControl } from '@renderer/features/tasks/quick-action-suggestion-control';
import { getTabMeta } from '@renderer/features/tasks/tabs/tab-meta';
import {
  useIsHostedTaskView,
  useRequireProvisionedTask,
  useTaskViewKind,
} from '@renderer/features/tasks/task-view-context';
import { SidebarChip } from '@renderer/lib/components/sidebar-chip';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Toggle } from '@renderer/lib/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { DevServerPills } from './components/dev-server-pills';

/**
 * Task titlebar slot: only renders the plain titlebar for non-ready states.
 * For ready tasks the titlebar lives INSIDE the main panel's horizontal split
 * (left column only), so the sidebar column reaches the top of the window and
 * hosts its own header row at the same height.
 */
export const TaskTitlebar = observer(function TaskTitlebar() {
  const hosted = useIsHostedTaskView();
  const kind = useTaskViewKind();

  if (kind !== 'ready') {
    return <Titlebar hosted={hosted} />;
  }

  return null;
});

export const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const provisionedTask = useRequireProvisionedTask();
  const { taskView } = provisionedTask;
  const hosted = useIsHostedTaskView();
  const projectStore = asMounted(getProjectStore(projectId));
  const isRemoteProject = projectStore?.data.type === 'ssh';

  return (
    <Titlebar
      hosted={hosted}
      centerSlot={hosted ? <HostedTaskTabStrip /> : undefined}
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          <QuickActionSuggestionControl />
          <TaskFinishControl />
          {!isRemoteProject && (
            <OpenInMenu path={provisionedTask.path} className="h-7 bg-background" borderless />
          )}
          {/* When the sidebar is expanded, both panel toggles live at the far
              right of the sidebar's own header strip instead. */}
          {taskView.isSidebarCollapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      size="icon-sm"
                      pressed={taskView.isTerminalDrawerOpen}
                      className="border-none"
                      onPressedChange={() =>
                        taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)
                      }
                    >
                      <PanelBottom className="size-3.5" />
                    </Toggle>
                  }
                />
                <TooltipContent>
                  {t('tasks.toggleTerminal')} <ShortcutHint settingsKey="toggleTerminalDrawer" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      size="icon-sm"
                      pressed={false}
                      className="border-none"
                      onPressedChange={() => taskView.setSidebarCollapsed(false)}
                    >
                      <PanelRight className="size-3.5" />
                    </Toggle>
                  }
                />
                <TooltipContent>
                  {t('tasks.toggleSidebar')} <ShortcutHint settingsKey="toggleRightSidebar" />
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      }
    />
  );
});

/**
 * Per-pane tab strip for a hosted (split-view extra) task. A hosted pane drops
 * the top-level bridge, so its `tabManager` tabs never reach the global
 * AppTabStrip — render them here, scoped to THIS pane's task, so the pane can
 * switch between its own overview / conversations / files / diffs.
 */
const HostedTaskTabStrip = observer(function HostedTaskTabStrip() {
  const { t } = useTranslation();
  const { tabManager } = useRequireProvisionedTask().taskView;
  const activeId = tabManager.resolvedActiveTabId;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [-webkit-app-region:no-drag] [&::-webkit-scrollbar]:hidden">
      {tabManager.resolvedTabs.map((tab) => {
        const meta = getTabMeta(tab);
        const isOverview = tab.kind === 'overview';
        return (
          <SidebarChip
            key={tab.tabId}
            label={meta.label}
            title={meta.title}
            icon={meta.icon}
            isActive={activeId === tab.tabId}
            closeLabel={t('common.close')}
            onSelect={() => tabManager.setActiveTab(tab.tabId)}
            onClose={isOverview ? undefined : () => tabManager.closeTab(tab.tabId)}
          />
        );
      })}
    </div>
  );
});
