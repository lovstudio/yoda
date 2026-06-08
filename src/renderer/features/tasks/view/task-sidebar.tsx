import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { isHarnessTab, isSessionFamilyTab } from '../types';
import { HarnessPanel } from './harness-panel';
import { SessionPanel } from './session-panel';

export const TaskSidebar = observer(function TaskSidebar() {
  const { taskView } = useProvisionedTask();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;
  const sessionActive = isSessionFamilyTab(activeTab);
  const harnessActive = isHarnessTab(activeTab);
  return (
    <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
      <div className="min-h-0 h-full overflow-hidden bg-background text-foreground">
        <Activity mode={sessionActive ? 'visible' : 'hidden'}>
          <SessionPanel />
        </Activity>
        <Activity mode={harnessActive ? 'visible' : 'hidden'}>
          <HarnessPanel />
        </Activity>
        <Activity mode={activeTab === 'changes' ? 'visible' : 'hidden'}>
          <ChangesPanel />
        </Activity>
        <Activity mode={activeTab === 'files' ? 'visible' : 'hidden'}>
          <EditorFileTree />
        </Activity>
      </div>
    </Activity>
  );
});
