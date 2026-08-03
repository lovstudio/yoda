import { observer } from 'mobx-react-lite';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TerminalWorkbench } from './terminal-workbench';
import { useCreateTerminal } from './use-create-terminal';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useRequireProvisionedTask();
  const terminalMgr = provisionedTask.terminals;
  const terminalTabView = provisionedTask.taskView.terminalTabs;
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const isVisible =
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.activeBottomPanelTab === 'terminals';
  const autoFocus = isActive && isVisible && provisionedTask.taskView.focusedRegion === 'bottom';
  const handleCreate = useCreateTerminal();

  return (
    <TerminalWorkbench
      terminalMgr={terminalMgr}
      terminalTabView={terminalTabView}
      paneId="terminal-drawer"
      layoutId={`terminal-drawer-inner:${taskId}`}
      visible={isVisible}
      autoFocus={autoFocus}
      remoteConnectionId={remoteConnectionId}
      onCreateTerminal={handleCreate}
      onFocus={() => provisionedTask.taskView.setFocusedRegion('bottom')}
    />
  );
});
