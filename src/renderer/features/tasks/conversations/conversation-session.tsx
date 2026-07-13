import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Power, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useWorkspaceWebLinks } from '@renderer/features/tasks/terminals/use-workspace-web-links';
import { buildFilePathDefaultOpenRequest } from '@renderer/lib/components/file-path-open';
import { rpc } from '@renderer/lib/ipc';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import type { ConversationStore } from './conversation-manager';
import { shouldAutoResumeConversation } from './conversation-session-utils';

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

/**
 * Live terminal + input + exited-state handling for ONE conversation. Shared by
 * the task's conversations panel (its active conversation) and the team-room
 * session inspector (a specific member's conversation), so a room session looks
 * and behaves exactly like the standard session tab. Must be rendered inside a
 * provisioned task view (ProvisionedTaskProvider + TaskViewWrapper).
 */
export const ConversationSession = observer(function ConversationSession({
  conversation,
  isVisible,
  autoFocus = false,
}: {
  conversation: ConversationStore;
  /** Resume the PTY session when visible (split-view panes are visible but not active). */
  isVisible: boolean;
  /** Focus the terminal when it becomes ready. */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { conversations } = provisioned;
  const mountedProject = asMounted(getProjectStore(projectId));
  const projectRoot = mountedProject?.data.path;
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const session = conversation.session;
  const sessionId = session?.sessionId ?? null;
  const sessionStatus = session?.status;
  const sessionPty = session?.pty ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);
  const lastAutoResumePtyRef = useRef<FrontendPty | null>(null);

  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminal: session?.pty?.terminal,
    containerRef: terminalContainerRef,
    enabled: Boolean(session?.pty),
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  // Focus the terminal when asked; fall back to the wrapper until it's ready.
  useEffect(() => {
    if (!autoFocus) return;
    if (terminalRef.current) {
      terminalRef.current.focus();
      focusPendingRef.current = false;
    } else {
      containerRef.current?.focus();
      focusPendingRef.current = true;
    }
  }, [autoFocus, sessionId]);

  useEffect(() => {
    if (sessionStatus === 'ready' && focusPendingRef.current) {
      focusPendingRef.current = false;
      terminalRef.current?.focus();
    }
  }, [sessionStatus]);

  // Resume the PTY when visible + ready (once per session id).
  useEffect(() => {
    if (!isVisible) {
      lastAutoResumePtyRef.current = null;
      return;
    }
    if (
      !sessionPty ||
      !shouldAutoResumeConversation({
        isVisible,
        sessionId,
        sessionStatus,
        sessionPty,
        lastAutoResumePty: lastAutoResumePtyRef.current,
      })
    ) {
      return;
    }
    lastAutoResumePtyRef.current = sessionPty;
    const initialSize = getResumeInitialSize(sessionPty, terminalContainerRef.current);
    void conversations.resumeConversation(conversation.data.id, initialSize);
  }, [conversation, conversations, isVisible, sessionId, sessionPty, sessionStatus]);

  const markConversationSubmitted = (forceWorking = false) => {
    conversation.setWorking({ force: forceWorking });
    void conversations.touchConversation(conversation.data.id);
    void getTaskStore(projectId, taskId)?.setNeedsReview(false);
  };
  const onSubmittedInput = (_message: string, isTaskInput: boolean) => {
    if (isTaskInput || conversation.status !== 'awaiting-input') return;
    markConversationSubmitted(true);
  };
  const onEnterPress = () => markConversationSubmitted(conversation.status === 'awaiting-input');
  const onInterruptPress = () => conversation.clearWorking();

  const handleReloadExitedSession = () => {
    const pty = conversation.session.pty;
    const initialSize = pty ? getResumeInitialSize(pty, terminalContainerRef.current) : undefined;
    void conversations.restartConversation(conversation.data.id, initialSize);
  };

  // Snapshot of the dead session for a bug report / paste into the agent.
  const [debugCopied, setDebugCopied] = useState(false);
  const debugCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debugCopyResetRef.current) clearTimeout(debugCopyResetRef.current);
    },
    []
  );
  const handleCopyExitDebugInfo = () => {
    const { data, session: s, status, sessionExited } = conversation;
    const lines = [
      'Yoda — agent session exited',
      `time: ${new Date().toISOString()}`,
      `runtime: ${agentConfig[data.runtimeId]?.name ?? data.runtimeId} (${data.runtimeId})`,
      `conversation: ${data.id}`,
      `task: ${data.taskId}`,
      `project: ${data.projectId}`,
      `ptySession: ${s.sessionId}`,
      `ptyStatus: ${s.status}`,
      `agentStatus: ${status}`,
      `sessionExited: ${sessionExited}`,
      `target: ${remoteConnectionId ? `ssh:${remoteConnectionId}` : 'local'}`,
      `workspace: ${provisioned.path}`,
      `createdAt: ${data.createdAt ?? 'n/a'}`,
      `lastInteractedAt: ${data.lastInteractedAt ?? 'n/a'}`,
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
    setDebugCopied(true);
    if (debugCopyResetRef.current) clearTimeout(debugCopyResetRef.current);
    debugCopyResetRef.current = setTimeout(() => setDebugCopied(false), 1500);
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
      workspaceRootAliases: projectRoot ? [projectRoot] : undefined,
      homeDir: typeof homeDir === 'string' ? homeDir : undefined,
      sshConnectionId: remoteConnectionId,
      onOpen: ({ filePath, absolutePath, line, column }) => {
        if (filePath) {
          provisioned.taskView.tabManager.openFileInSidebar(filePath, { line, column });
          provisioned.taskView.setSidebarCollapsed(false);
          return;
        }
        if (absolutePath) {
          void rpc.app.openIn(
            buildFilePathDefaultOpenRequest({
              absolutePath,
              sshConnectionId: remoteConnectionId,
              line,
              column,
            })
          );
        }
      },
    }),
    [provisioned.path, provisioned.taskView, projectRoot, remoteConnectionId, homeDir]
  );
  const webLinks = useWorkspaceWebLinks();

  if (!sessionId || session?.status !== 'ready' || !session.pty) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <div
        ref={terminalContainerRef}
        className="relative flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden"
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
          sessionId={sessionId}
          pty={session.pty}
          className="h-full w-full min-w-0"
          onEnterPress={onEnterPress}
          onSubmittedInput={onSubmittedInput}
          onInterruptPress={onInterruptPress}
          mapShiftEnterToCtrlJ
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={webLinks}
        />
        {conversation.sessionExited ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 duration-300 animate-in fade-in-0 slide-in-from-bottom-2">
            <div className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-border-primary/70 bg-background/85 py-1.5 pr-1.5 pl-3 shadow-sm ring-1 ring-foreground/5 backdrop-blur-md">
              <span className="flex items-center gap-2 pr-0.5 text-sm text-foreground-passive">
                <span
                  className="relative flex size-2 shrink-0 items-center justify-center"
                  aria-hidden
                >
                  <span className="absolute size-2 rounded-full bg-status-cancelled/30" />
                  <span className="size-1.5 rounded-full bg-status-cancelled" />
                </span>
                <Power className="size-3.5 shrink-0 text-foreground-passive" aria-hidden />
                <span className="font-medium text-foreground-muted">
                  {t('tasks.conversations.sessionExited')}
                </span>
              </span>
              <span className="h-4 w-px shrink-0 bg-border-primary/60" aria-hidden />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={handleCopyExitDebugInfo}
                      aria-label={t('common.copyDebugInfo')}
                    >
                      {debugCopied ? (
                        <Check className="size-3.5 text-status-done" aria-hidden />
                      ) : (
                        <Copy className="size-3.5" aria-hidden />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {debugCopied ? t('common.debugInfoCopied') : t('common.copyDebugInfo')}
                </TooltipContent>
              </Tooltip>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReloadExitedSession}
                className="h-7 gap-1.5"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t('tasks.tabs.reloadConversation')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
