import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import {
  getCellMetrics,
  measureDimensions,
  type TerminalDimensions,
} from '@renderer/lib/pty/pty-dimensions';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import type { ConversationStore } from './conversation-manager';

function getResumeInitialSize(
  pty: FrontendPty,
  container: HTMLElement | null
): TerminalDimensions | undefined {
  const cell = getCellMetrics(pty.terminal);
  if (container && cell) {
    const measured = measureDimensions(container, cell.width, cell.height);
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
  const showCreateConversationModal = useShowModal('createConversationModal');
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

  const handleCreate = () =>
    showCreateConversationModal({
      connectionId: remoteConnectionId,
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tm.openConversation(conversationId);
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
  const fileLinks = useMemo<TerminalFileLinkOptions>(
    () => ({
      workspaceRoot: provisioned.path,
      onOpen: ({ filePath, line, column }) => {
        provisioned.taskView.tabManager.openFile(filePath, { line, column });
        provisioned.taskView.setFocusedRegion('main');
      },
    }),
    [provisioned.path, provisioned.taskView]
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-2">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
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
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {activeSessionId && activeSession?.status === 'ready' && activeSession.pty ? (
                  <div ref={terminalContainerRef} className="relative flex h-full min-h-0 flex-1">
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
                      className="h-full w-full"
                      onEnterPress={onEnterPress}
                      onSubmittedInput={onSubmittedInput}
                      onInterruptPress={onInterruptPress}
                      mapShiftEnterToCtrlJ
                      remoteConnectionId={remoteConnectionId}
                      fileLinks={fileLinks}
                    />
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
