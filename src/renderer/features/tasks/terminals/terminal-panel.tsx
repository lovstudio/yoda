import { useHotkey } from '@tanstack/react-hotkeys';
import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefaultLayout } from 'react-resizable-panels';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TerminalDrawerSidebar } from './terminal-drawer-sidebar';
import { TerminalPtyContent } from './terminal-pty-content';
import { useCreateTerminal } from './use-create-terminal';
import { useWorkspaceFileLinks } from './use-workspace-file-links';
import { useWorkspaceWebLinks } from './use-workspace-web-links';
import { WorkspaceShellTerminal } from './workspace-shell-terminal';

export const TerminalsPanel = observer(function TerminalsPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisionedTask = useProvisionedTask();
  const terminalMgr = provisionedTask.terminals;
  const terminalTabView = provisionedTask.taskView.terminalTabs;
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const newTerminalHotkey = getEffectiveHotkey('newTerminal', keyboard);
  const drawerLayoutId = `terminal-drawer-inner:${taskId}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: drawerLayoutId,
    storage: localStorage,
  });

  const autoFocus =
    isActive &&
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.activeBottomPanelTab === 'terminals' &&
    provisionedTask.taskView.focusedRegion === 'bottom';
  const isVisible =
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.activeBottomPanelTab === 'terminals';

  const activeTerminalId = terminalTabView.activeTabId;
  const taskTerminalSession =
    terminalTabView.tabs.find((tab) => tab.data.id === activeTerminalId)?.session ?? null;
  const hostedQuickAction = isActive && workspaceShellStore.isCommandHostedInTask(taskId);
  const quickActionSelected =
    hostedQuickAction && workspaceShellStore.isCommandSelectedInTask(taskId);

  const allSessionIds = useMemo(
    () => terminalTabView.tabs.map((tab) => tab.session.sessionId),
    [terminalTabView.tabs]
  );

  useTabShortcuts(terminalTabView, {
    focused: isPanelFocused && !quickActionSelected,
  });

  const handleCreate = useCreateTerminal();
  const handleCreateTaskTerminal = () => {
    workspaceShellStore.selectTaskTerminal(taskId);
    return handleCreate();
  };

  useHotkey(getHotkeyRegistration('newTerminal', keyboard), () => void handleCreateTaskTerminal(), {
    enabled: newTerminalHotkey !== null,
    conflictBehavior: 'replace',
  });

  const fileLinks = useWorkspaceFileLinks(remoteConnectionId);
  const webLinks = useWorkspaceWebLinks();

  const emptyState = (
    <EmptyState
      icon={<Terminal className="h-5 w-5 text-muted-foreground" />}
      label={t('tasks.terminals.emptyTitle')}
      description={t('tasks.terminals.emptyDescription')}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={handleCreateTaskTerminal}
          className="flex items-center gap-2"
        >
          {t('tasks.terminals.newTerminal')}
          <ShortcutHint settingsKey="newTerminal" />
        </Button>
      }
    />
  );

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id={drawerLayoutId}
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      onFocus={() => {
        setIsPanelFocused(true);
        provisionedTask.taskView.setFocusedRegion('bottom');
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsPanelFocused(false);
        }
      }}
    >
      <ResizablePanel id="terminal-drawer-pty" minSize="30%">
        {quickActionSelected ? (
          <div className="flex h-full min-h-0 flex-col">
            <WorkspaceShellTerminal
              active={isVisible}
              paneId={`terminal-drawer-quick-action:${taskId}`}
            />
          </div>
        ) : (
          <TerminalPtyContent
            className="h-full"
            activeSession={taskTerminalSession}
            allSessionIds={allSessionIds}
            paneId="terminal-drawer"
            active={isVisible}
            autoFocus={autoFocus}
            emptyState={emptyState}
            remoteConnectionId={remoteConnectionId}
            fileLinks={fileLinks}
            webLinks={webLinks}
          />
        )}
      </ResizablePanel>
      <ResizableHandle className="hover:bg-background-2" />
      <ResizablePanel id="terminal-drawer-sidebar" defaultSize="25%" minSize="150px" maxSize="50%">
        <TerminalDrawerSidebar
          className="h-full"
          terminalTabView={terminalTabView}
          activeTerminalId={quickActionSelected ? undefined : activeTerminalId}
          onSelectTerminal={(id) => {
            workspaceShellStore.selectTaskTerminal(taskId);
            terminalTabView.setActiveTab(id);
          }}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr?.renameTerminal(id, name)}
          onCreateTerminal={() => void handleCreateTaskTerminal()}
          hostedQuickAction={
            hostedQuickAction
              ? {
                  label: t('workspaceRuntime.quickAction', {
                    label: workspaceShellStore.commandLabel ?? t('projects.quickActions.title'),
                  }),
                  isActive: quickActionSelected,
                  onSelect: () => workspaceShellStore.selectHostedCommand(taskId),
                  onClose: () => workspaceShellStore.close(),
                }
              : undefined
          }
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
