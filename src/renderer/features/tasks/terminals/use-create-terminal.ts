import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { log } from '@renderer/utils/logger';
import { getTerminalsPaneSize, nextTerminalName } from './terminal-tabs';

/** Creates a drawer terminal (sequential name), activates it, focuses bottom. */
export function useCreateTerminal(): () => Promise<void> {
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const terminalMgr = provisionedTask.terminals;
  const terminalTabView = provisionedTask.taskView.terminalTabs;

  return async () => {
    if (!terminalMgr) return;
    provisionedTask.taskView.setFocusedRegion('bottom');
    const id = crypto.randomUUID();
    const name = nextTerminalName((terminalTabView.tabs ?? []).map((s) => s.data.name));
    try {
      await terminalMgr.createTerminal({
        id,
        projectId,
        taskId,
        name,
        initialSize: getTerminalsPaneSize(),
      });
      terminalTabView.setActiveTab(id);
    } catch (error) {
      log.error('Failed to create terminal:', error);
    }
  };
}
