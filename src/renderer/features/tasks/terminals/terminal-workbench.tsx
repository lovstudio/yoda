import { useHotkey } from '@tanstack/react-hotkeys';
import { Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefaultLayout } from 'react-resizable-panels';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { TerminalDrawerSidebar } from './terminal-drawer-sidebar';
import type { TerminalManagerStore } from './terminal-manager';
import { TerminalPtyContent } from './terminal-pty-content';
import type { TerminalTabViewStore } from './terminal-tab-view-store';
import { useWorkspaceFileLinks } from './use-workspace-file-links';
import { useWorkspaceWebLinks } from './use-workspace-web-links';

export const TerminalWorkbench = observer(function TerminalWorkbench({
  terminalMgr,
  terminalTabView,
  paneId,
  layoutId,
  visible,
  autoFocus,
  remoteConnectionId,
  onCreateTerminal,
  onFocus,
}: {
  terminalMgr: TerminalManagerStore;
  terminalTabView: TerminalTabViewStore;
  paneId: string;
  layoutId: string;
  visible: boolean;
  autoFocus: boolean;
  remoteConnectionId?: string;
  onCreateTerminal: () => Promise<void> | void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const newTerminalHotkey = getEffectiveHotkey('newTerminal', keyboard);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: layoutId,
    storage: localStorage,
  });
  const activeTerminalId = terminalTabView.activeTabId;
  const activeSession =
    terminalTabView.tabs.find((tab) => tab.data.id === activeTerminalId)?.session ?? null;
  const allSessionIds = useMemo(
    () => terminalTabView.tabs.map((tab) => tab.session.sessionId),
    [terminalTabView.tabs]
  );

  useTabShortcuts(terminalTabView, { focused: isPanelFocused && visible });
  useHotkey(getHotkeyRegistration('newTerminal', keyboard), () => void onCreateTerminal(), {
    enabled: newTerminalHotkey !== null && visible,
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
          onClick={() => void onCreateTerminal()}
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
      id={layoutId}
      className="h-full"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      onFocus={() => {
        setIsPanelFocused(true);
        onFocus();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsPanelFocused(false);
        }
      }}
    >
      <ResizablePanel id={`${layoutId}:pty`} minSize="30%">
        <TerminalPtyContent
          className="h-full"
          activeSession={activeSession}
          allSessionIds={allSessionIds}
          paneId={paneId}
          active={visible}
          autoFocus={autoFocus}
          emptyState={emptyState}
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={webLinks}
        />
      </ResizablePanel>
      <ResizableHandle className="hover:bg-background-2" />
      <ResizablePanel id={`${layoutId}:sidebar`} defaultSize="25%" minSize="150px" maxSize="50%">
        <TerminalDrawerSidebar
          className="h-full"
          terminalTabView={terminalTabView}
          activeTerminalId={activeTerminalId}
          onSelectTerminal={(id) => terminalTabView.setActiveTab(id)}
          onRemoveTerminal={(id) => terminalTabView.removeTab(id)}
          onRenameTerminal={(id, name) => void terminalMgr.renameTerminal(id, name)}
          onCreateTerminal={() => void onCreateTerminal()}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
