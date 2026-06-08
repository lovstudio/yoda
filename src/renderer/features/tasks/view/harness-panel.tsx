import { observer } from 'mobx-react-lite';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { ContextPanel } from '../context-panel';
import { isHarnessTab } from '../types';

/**
 * Harness sidebar surface — the agent runtime view. A single 百叶窗 accordion
 * of blinds: LLM context, memory, tools, MCP, skills, and the hooks inspector
 * (each a collapsible window managed inside ContextPanel).
 */
export const HarnessPanel = observer(function HarnessPanel() {
  const { taskView } = useProvisionedTask();
  const active = !taskView.isSidebarCollapsed && isHarnessTab(taskView.sidebarTab);
  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <ContextPanel chromeless active={active} />
    </div>
  );
});
