import { useHotkey } from '@tanstack/react-hotkeys';
import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
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

  const autoFocus =
    isActive &&
    provisionedTask.taskView.isTerminalDrawerOpen &&
    provisionedTask.taskView.activeBottomPanelTab === 'terminals' &&
    provisionedTask.taskView.focusedRegion === 'bottom';

  const activeTerminalId = terminalTabView.activeTabId;
  const activeSession =
    terminalTabView.tabs.find((tab) => tab.data.id === activeTerminalId)?.session ?? null;

  const allSessionIds = useMemo(
    () => terminalTabView.tabs.map((tab) => tab.session.sessionId),
    [terminalTabView.tabs]
  );

  useTabShortcuts(terminalTabView, { focused: isPanelFocused });

  const handleCreate = useCreateTerminal();

  useHotkey(getHotkeyRegistration('newTerminal', keyboard), () => void handleCreate(), {
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
          onClick={handleCreate}
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
      id="terminal-drawer-inner"
      className="h-full"
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
        <TerminalPtyContent
          className="h-full"
          activeSession={activeSession}
          allSessionIds={allSessionIds}
          paneId="terminal-drawer"
          autoFocus={autoFocus}
          emptyState={emptyState}
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={webLinks}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-background-2" />
      <ResizablePanel id="terminal-drawer-sidebar" defaultSize="25%" minSize="150px" maxSize="50%">
        <TerminalDrawerSidebar
          className="h-full"
          terminalTabView={terminalTabView}
          activeTerminalId={activeTerminalId}
          onSelectTerminal={(id) => terminalTabView.setActiveTab(id)}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr?.renameTerminal(id, name)}
          onCreateTerminal={() => void handleCreate()}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
