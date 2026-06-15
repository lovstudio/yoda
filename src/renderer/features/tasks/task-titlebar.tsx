import { PanelBottom, PanelRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { TaskFinishControl } from '@renderer/features/tasks/finish-flow/finish-control';
import { getTaskStore, taskViewKind } from '@renderer/features/tasks/stores/task-selectors';
import {
  useIsHostedTaskView,
  useProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
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
  const { projectId, taskId } = useTaskViewContext();
  const hosted = useIsHostedTaskView();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

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
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;
  const hosted = useIsHostedTaskView();
  const projectStore = asMounted(getProjectStore(projectId));
  const isRemoteProject = projectStore?.data.type === 'ssh';

  return (
    <Titlebar
      hosted={hosted}
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
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
