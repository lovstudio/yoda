import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import {
  getCellMetrics,
  getTerminalFitScrollbarWidth,
  measureDimensions,
  TERMINAL_FIT_GUARD_COLUMNS,
  type TerminalDimensions,
} from '@renderer/lib/pty/pty-dimensions';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import type { ConversationStore } from './conversation-manager';

export function getResumeInitialSize(
  pty: FrontendPty,
  container: HTMLElement | null
): TerminalDimensions | undefined {
  const cell = getCellMetrics(pty.terminal);
  if (container && cell) {
    const measured = measureDimensions(
      container,
      cell.width,
      cell.height,
      getTerminalFitScrollbarWidth(pty.terminal),
      TERMINAL_FIT_GUARD_COLUMNS
    );
    if (measured) return measured;
  }
  if (pty.terminal.cols > 0 && pty.terminal.rows > 0) {
    return { cols: pty.terminal.cols, rows: pty.terminal.rows };
  }
  return undefined;
}

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { conversations } = provisioned;
  const { tabManager: tm } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

  const handleCreate = () =>
    showNewConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationIds }) => {
        const conversationId = conversationIds[0];
        if (conversationId) tm.openConversation(conversationId);
        provisioned.taskView.setFocusedRegion('main');
      },
    });

  // Build session ID list for PaneSizingProvider (all open conversation tabs).
  const allSessionIds = useMemo(() => {
    return tm.resolvedTabs
      .filter((t) => t.kind === 'conversation')
      .map((t) => t.store.session.sessionId)
      .filter(Boolean) as string[];
  }, [tm.resolvedTabs]);

  const activeConversation: ConversationStore | undefined = tm.activeConversation;
  const activeSession = activeConversation?.session ?? null;
  const activeSessionId = activeSession?.sessionId ?? null;
  const hasConversationTabs = tm.resolvedTabs.some((t) => t.kind === 'conversation');
  const conversationStores = Array.from(conversations.conversations.values()).sort((a, b) => {
    const aTime = a.data.lastInteractedAt ? Date.parse(a.data.lastInteractedAt) : 0;
    const bTime = b.data.lastInteractedAt ? Date.parse(b.data.lastInteractedAt) : 0;
    return bTime - aTime;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);
  const lastAutoResumeSessionRef = useRef<string | null>(null);

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: activeSession?.pty?.terminal,
    containerRef: terminalContainerRef,
    enabled: Boolean(activeSession?.pty),
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  useEffect(() => {
    if (!autoFocus) return;
    if (terminalRef.current) {
      terminalRef.current.focus();
      focusPendingRef.current = false;
    } else {
      containerRef.current?.focus();
      focusPendingRef.current = true;
    }
  }, [autoFocus, activeSessionId]);

  const sessionStatus = activeSession?.status;
  useEffect(() => {
    if (!isActive) {
      lastAutoResumeSessionRef.current = null;
      return;
    }
    if (
      !activeConversation ||
      !activeSessionId ||
      activeSession?.status !== 'ready' ||
      !activeSession.pty
    ) {
      return;
    }
    if (lastAutoResumeSessionRef.current === activeSessionId) return;
    lastAutoResumeSessionRef.current = activeSessionId;
    const initialSize = getResumeInitialSize(activeSession.pty, terminalContainerRef.current);
    void conversations.resumeConversation(activeConversation.data.id, initialSize);
  }, [activeConversation, activeSession, activeSessionId, conversations, isActive, sessionStatus]);

  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  const markConversationSubmitted = (forceWorking = false) => {
    if (!activeConversation) return;
    activeConversation.setWorking({ force: forceWorking });
    void conversations.touchConversation(activeConversation.data.id);
    void getTaskStore(projectId, taskId)?.setNeedsReview(false);
  };

  const onSubmittedInput = activeConversation
    ? (_message: string, isTaskInput: boolean) => {
        if (isTaskInput || activeConversation.status !== 'awaiting-input') return;
        markConversationSubmitted(true);
      }
    : undefined;

  const onEnterPress = activeConversation
    ? () => {
        markConversationSubmitted(activeConversation.status === 'awaiting-input');
      }
    : undefined;

  const onInterruptPress = activeConversation ? () => activeConversation.clearWorking() : undefined;

  // The agent process died on its own (e.g. a Codex self-update exits the CLI).
  // Resume would be a no-op for the user (the auto-resume guard already ran for
  // this session), so offer the restart path explicitly.
  const handleReloadExitedSession = () => {
    if (!activeConversation) return;
    const pty = activeConversation.session.pty;
    const initialSize = pty ? getResumeInitialSize(pty, terminalContainerRef.current) : undefined;
    void conversations.restartConversation(activeConversation.data.id, initialSize);
  };
  const { data: homeDir } = useQuery({
    queryKey: ['homeDir'],
    queryFn: () => rpc.app.getHomeDir(),
    staleTime: Infinity,
    enabled: !remoteConnectionId,
  });
  const fileLinks = useMemo<TerminalFileLinkOptions>(
    () => ({
      workspaceRoot: provisioned.path,
      homeDir: typeof homeDir === 'string' ? homeDir : undefined,
      isRemote: Boolean(remoteConnectionId),
      onOpen: ({ filePath, absolutePath, line, column }) => {
        if (filePath) {
          // Open into the sidebar so the conversation stays visible.
          provisioned.taskView.tabManager.openFileInSidebar(filePath, { line, column });
          provisioned.taskView.setSidebarCollapsed(false);
          return;
        }
        if (absolutePath) {
          void rpc.app.openIn({ app: 'finder', path: absolutePath });
        }
      },
    }),
    [provisioned.path, provisioned.taskView, remoteConnectionId, homeDir]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-[var(--xterm-bg)] px-2 pt-2">
      <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden outline-none"
          onFocus={() => {
            if (isActive) provisioned.taskView.setFocusedRegion('main');
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              // focus left the panel — no region change needed
            }
          }}
        >
          <PaneSizingProvider paneId="conversations" sessionIds={allSessionIds}>
            {!hasConversationTabs ? (
              conversationStores.length > 0 ? (
                <ConversationSessionList
                  conversations={conversationStores}
                  title={t('tasks.conversations.sessions')}
                  createLabel={t('tasks.conversations.createConversation')}
                  createAction={handleCreate}
                  onOpen={(conversationId) => {
                    tm.openConversation(conversationId);
                    provisioned.taskView.setFocusedRegion('main');
                  }}
                />
              ) : (
                <EmptyState
                  icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
                  label={t('tasks.conversations.emptyTitle')}
                  description={t('tasks.conversations.emptyDescription')}
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCreate}
                      className="flex items-center gap-2"
                    >
                      {t('tasks.conversations.createConversation')}
                      <ShortcutHint settingsKey="newConversation" />
                    </Button>
                  }
                />
              )
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {activeSessionId && activeSession?.status === 'ready' && activeSession.pty ? (
                  <div
                    ref={terminalContainerRef}
                    className="relative flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden"
                  >
                    <TerminalSearchOverlay
                      isOpen={isSearchOpen}
                      fullWidth
                      searchQuery={searchQuery}
                      searchStatus={searchStatus}
                      searchInputRef={searchInputRef}
                      onQueryChange={handleSearchQueryChange}
                      onStep={stepSearch}
                      onClose={closeSearch}
                    />
                    <PtyPane
                      ref={terminalRef}
                      sessionId={activeSessionId}
                      pty={activeSession.pty}
                      className="h-full w-full min-w-0"
                      onEnterPress={onEnterPress}
                      onSubmittedInput={onSubmittedInput}
                      onInterruptPress={onInterruptPress}
                      mapShiftEnterToCtrlJ
                      remoteConnectionId={remoteConnectionId}
                      fileLinks={fileLinks}
                    />
                    {activeConversation?.sessionExited ? (
                      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 border-t border-border bg-background/95 px-4 py-2.5">
                        <span className="text-sm text-muted-foreground">
                          {t('tasks.conversations.sessionExited')}
                        </span>
                        <Button size="sm" variant="outline" onClick={handleReloadExitedSession}>
                          {t('tasks.tabs.reloadConversation')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </PaneSizingProvider>
        </div>
      </div>
    </div>
  );
});

const ConversationSessionList = observer(function ConversationSessionList({
  conversations,
  title,
  createLabel,
  createAction,
  onOpen,
}: {
  conversations: ConversationStore[];
  title: string;
  createLabel: string;
  createAction: () => void;
  onOpen: (conversationId: string) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <span className="shrink-0 text-xs tabular-nums text-foreground-passive">
            {conversations.length}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={createAction}
          className="min-w-0 max-w-[60%] gap-2 overflow-hidden"
        >
          <span className="truncate">{createLabel}</span>
          <ShortcutHint settingsKey="newConversation" className="shrink-0" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
          {conversations.map((conversation) => (
            <ConversationSessionListItem
              key={conversation.data.id}
              conversation={conversation}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

const ConversationSessionListItem = observer(function ConversationSessionListItem({
  conversation,
  onOpen,
}: {
  conversation: ConversationStore;
  onOpen: (conversationId: string) => void;
}) {
  const runtimeId = conversation.data.runtimeId;
  const config = agentConfig[runtimeId];
  const title = conversation.data.title.trim() || conversation.data.id;

  return (
    <button
      type="button"
      className={cn(
        'group flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-transparent px-2 text-left outline-none transition-colors',
        'hover:border-border hover:bg-background-1 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring'
      )}
      onClick={() => onOpen(conversation.data.id)}
      title={title}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-2">
        {config ? (
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4"
          />
        ) : (
          <MessageSquare className="size-4 text-foreground-passive" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
      <span className="flex shrink-0 items-center text-xs text-foreground-passive">
        {conversation.indicatorStatus ? (
          <AgentStatusIndicator status={conversation.indicatorStatus} />
        ) : (
          <RelativeTime value={conversation.data.lastInteractedAt ?? ''} compact />
        )}
      </span>
    </button>
  );
});
