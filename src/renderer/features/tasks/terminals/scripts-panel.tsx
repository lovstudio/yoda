import { ScrollText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { ScriptsDrawerSidebar } from './terminal-drawer-sidebar';
import { TerminalPtyContent } from './terminal-pty-content';
import { useWorkspaceFileLinks } from './use-workspace-file-links';
import { useWorkspaceWebLinks } from './use-workspace-web-links';

/** Bottom-drawer scripts mode: lifecycle script PTYs + a run/stop sidebar. */
export const ScriptsPanel = observer(function ScriptsPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const lifecycleScriptsMgr = provisionedTask.workspace.lifecycleScripts ?? null;
  const isActive = useIsActiveTask(taskId);
  const { navigate } = useNavigate();
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const fileLinks = useWorkspaceFileLinks(remoteConnectionId);
  const webLinks = useWorkspaceWebLinks();

  const autoFocus =
    isActive &&
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.activeBottomPanelTab === 'scripts' &&
    provisionedTask.taskView.focusedRegion === 'bottom';

  const scripts = lifecycleScriptsMgr?.tabs ?? [];
  const activeScript = lifecycleScriptsMgr?.activeTab ?? scripts[0];

  const handleRun = () => {
    if (!activeScript) return;
    activeScript.markRunning();
    void rpc.terminals
      .runLifecycleScript({
        projectId,
        workspaceId: provisionedTask.workspaceId,
        type: activeScript.data.type,
      })
      .catch(() => {
        activeScript.markExited();
      });
  };

  const handleStop = () => {
    if (!activeScript) return;
    void rpc.pty.sendInput(activeScript.session.sessionId, '\x03');
  };

  if (scripts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<ScrollText className="h-5 w-5 text-muted-foreground" />}
          label={t('tasks.terminals.scriptsEmptyTitle')}
          description={t('tasks.terminals.scriptsEmptyDescription')}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('project', { projectId, view: 'settings' })}
            >
              {t('tasks.terminals.configureInProjectSettings')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id="scripts-drawer-inner"
      className="h-full"
      onFocus={() => provisionedTask.taskView.setFocusedRegion('bottom')}
    >
      <ResizablePanel id="scripts-drawer-pty" minSize="30%">
        <TerminalPtyContent
          className="h-full"
          activeSession={activeScript?.session ?? null}
          allSessionIds={scripts.map((s) => s.session.sessionId)}
          paneId="scripts-drawer"
          autoFocus={autoFocus}
          emptyState={null}
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={webLinks}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-background-2" />
      <ResizablePanel id="scripts-drawer-sidebar" defaultSize="25%" minSize="150px" maxSize="50%">
        <ScriptsDrawerSidebar
          className="h-full"
          lifecycleScriptsMgr={lifecycleScriptsMgr}
          activeScriptId={activeScript?.data.id}
          onSelectScript={(id) => lifecycleScriptsMgr?.setActiveTab(id)}
          onRunScript={handleRun}
          onStopScript={handleStop}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
