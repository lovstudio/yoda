import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Loader2, Power, RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAttachImagesAsPaths } from '@renderer/features/tasks/hooks/use-attach-images-as-paths';
import {
  getConversationRuntimeStatus,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
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
import {
  getTerminalFileLinkInternalDestination,
  openTerminalGlobalFileInYoda,
} from '@renderer/lib/pty/terminal-file-link-open';
import type { TerminalFileLinkOptions } from '@renderer/lib/pty/terminal-file-links';
import { TerminalSearchOverlay } from '@renderer/lib/pty/terminal-search-overlay';
import { useTerminalSearch } from '@renderer/lib/pty/use-terminal-search';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { completeTaskOpenTrace } from '../task-open-performance';
import type { ConversationStore } from './conversation-manager';
import { ConversationSessionPendingState } from './conversation-session-pending-state';
import {
  shouldAutoResumeConversation,
  shouldProbeConversationSession,
} from './conversation-session-utils';

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
 * ready task view (TaskViewWrapper's discriminated state snapshot).
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
  const provisioned = useRequireProvisionedTask();
  const attachImagesAsPaths = useAttachImagesAsPaths(projectId);
  const { conversations } = provisioned;
  const mountedProject = asMounted(getProjectStore(projectId));
  const projectRoot = mountedProject?.data.path;
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const session = conversation.session;
  const sessionId = session?.sessionId ?? null;
  const sessionStatus = session?.status;
  const sessionPty = session?.pty ?? null;
  const agentStatus = getConversationRuntimeStatus(conversation);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<{ focus: () => void }>(null);
  const focusPendingRef = useRef(false);
  const [visibleFrame, setVisibleFrame] = useState<{
    pty: FrontendPty | null;
    ready: boolean;
  }>({ pty: null, ready: false });
  const lastAutoResumePtyRef = useRef<FrontendPty | null>(null);
  const suppressNextAutoResumeRef = useRef(false);

  // An inactive task can remain mounted in a hosted/split pane. Revoke its
  // semantic frame during the layout phase so returning to that route starts
  // with the stable overlay already present; a passive reset leaves one paint
  // where xterm is intentionally hidden but the old ready state removes the
  // overlay, producing the blank flash reported during rapid task switches.
  useLayoutEffect(() => {
    if (isVisible) return;
    setVisibleFrame((current) =>
      current.pty === null && !current.ready ? current : { pty: null, ready: false }
    );
  }, [isVisible]);

  const sessionStateTraceKey =
    log.level === 'debug'
      ? [
          projectId,
          taskId,
          conversation.data.id,
          sessionId ?? '',
          isVisible,
          autoFocus,
          sessionStatus ?? '',
          Boolean(sessionPty),
          Boolean(session?.connectionError),
          agentStatus,
          conversation.sessionExited,
        ].join('\u001f')
      : '';
  const lastSessionStateTraceKey = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionStateTraceKey || lastSessionStateTraceKey.current === sessionStateTraceKey) return;
    lastSessionStateTraceKey.current = sessionStateTraceKey;
    log.debug('[conversation-session] state', {
      projectId,
      taskId,
      conversationId: conversation.data.id,
      sessionId,
      isVisible,
      autoFocus,
      ptyStatus: sessionStatus ?? null,
      hasFrontendPty: Boolean(sessionPty),
      hasPreparationError: Boolean(session?.connectionError),
      agentStatus,
      sessionExited: conversation.sessionExited,
    });
  }, [
    autoFocus,
    conversation.data.id,
    conversation.sessionExited,
    agentStatus,
    isVisible,
    projectId,
    session?.connectionError,
    sessionId,
    sessionPty,
    sessionStateTraceKey,
    sessionStatus,
    taskId,
  ]);

  // Visibility, not generic status observation, owns connection demand. Split
  // panes pass isVisible=true even when they are not the routed active task.
  useEffect(() => {
    if (!isVisible || !session) return;
    void session.connect().catch(() => {});
  }, [isVisible, session, sessionStatus]);

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

  // Keep keyboard navigation anchored in the destination shell while its
  // terminal is staged. The xterm itself is focused only after its canonical
  // frame crosses the visible paint ACK below.
  useEffect(() => {
    if (!autoFocus) return;
    focusPendingRef.current = true;
    if (!document.querySelector('[role="dialog"]')) {
      containerRef.current?.focus();
    }
  }, [autoFocus, sessionId]);

  useEffect(() => {
    if (!isVisible || !sessionPty || sessionStatus !== 'ready') return;
    let active = true;
    let frameReportedReady = false;
    let dialogObserver: MutationObserver | null = null;
    let focusFrame: number | null = null;
    let focusAttempts = 0;
    let frameRetryRunning = false;
    let ensureFrameRetry = () => {};
    const shouldContinue = () => active && isVisible;
    const completeReadyTrace = () => {
      completeTaskOpenTrace(projectId, taskId, {
        renderer: 'agents',
        canonicalFrame: true,
        inputFocused: sessionPty.terminal.textarea === document.activeElement,
      });
    };
    const focusCanonicalTerminal = () => {
      if (!active || !autoFocus || !focusPendingRef.current) {
        if (active && !autoFocus) completeReadyTrace();
        return;
      }
      if (document.querySelector('[role="dialog"]')) {
        dialogObserver ??= new MutationObserver(() => {
          if (document.querySelector('[role="dialog"]')) return;
          dialogObserver?.disconnect();
          dialogObserver = null;
          requestAnimationFrame(focusCanonicalTerminal);
        });
        dialogObserver.observe(document.body, { childList: true, subtree: true });
        return;
      }
      terminalRef.current?.focus();
      focusPendingRef.current = sessionPty.terminal.textarea !== document.activeElement;
      if (!focusPendingRef.current) {
        completeReadyTrace();
        return;
      }
      // React ref attachment, browser focus ownership and xterm's hidden
      // textarea can settle on adjacent frames even without a dialog. Retry a
      // small bounded number of paints instead of permanently abandoning input
      // focus after one unlucky frame.
      if (focusAttempts < 8) {
        focusAttempts += 1;
        focusFrame = requestAnimationFrame(focusCanonicalTerminal);
      }
    };

    setVisibleFrame({ pty: sessionPty, ready: false });
    const publishFrameState = (frameReady: boolean) => {
      if (!active) return;
      if (frameReady !== frameReportedReady) {
        frameReportedReady = frameReady;
        setVisibleFrame({ pty: sessionPty, ready: frameReady });
        if (frameReady) {
          focusCanonicalTerminal();
        } else if (autoFocus) {
          focusPendingRef.current = true;
          focusAttempts = 0;
        }
      }
      // The same FrontendPty can advance to a later backend generation after
      // its first frame was already reported. Restart the single-flight ACK
      // loop whenever that authoritative generation-start signal invalidates
      // the old frame; otherwise a background-window timeout can leave the
      // semantic loading surface in place forever after the final bytes arrive.
      if (!frameReady) ensureFrameRetry();
    };
    const unsubscribeFrameState = sessionPty.subscribeVisibleFrameState(publishFrameState);

    // A browser paint can be temporarily unavailable (background window,
    // resize transaction, or a generation that has not produced its complete
    // TUI yet). Keep retrying the ACK while this route owns the session. Later
    // PTY output also schedules an immediate retry, so a five-second miss can
    // never strand the loading surface over a subsequently valid terminal.
    ensureFrameRetry = () => {
      if (!shouldContinue() || frameReportedReady || frameRetryRunning) return;
      frameRetryRunning = true;
      void (async () => {
        try {
          while (shouldContinue() && !frameReportedReady) {
            const frameReady = await sessionPty.waitForVisibleFrame(shouldContinue);
            if (!shouldContinue()) return;
            publishFrameState(frameReady);
            if (frameReady) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
          }
        } finally {
          frameRetryRunning = false;
          // Cover a false transition delivered between the loop's final
          // condition and its cleanup without starting concurrent waiters.
          if (shouldContinue() && !frameReportedReady) ensureFrameRetry();
        }
      })();
    };
    ensureFrameRetry();

    return () => {
      active = false;
      unsubscribeFrameState();
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);
      dialogObserver?.disconnect();
    };
  }, [autoFocus, isVisible, projectId, sessionPty, sessionStatus, taskId]);

  // The xterm callback above proves its rows painted, but setVisibleFrame is
  // still only a queued React update at that point. Keep the main-process
  // generation claim until React has committed removal of the semantic opening
  // surface and the browser crosses the following paint boundary.
  useLayoutEffect(() => {
    if (!isVisible || visibleFrame.pty !== sessionPty || !visibleFrame.ready || !sessionPty) return;
    const paint = requestAnimationFrame(() => sessionPty.releaseCanonicalRevealClaim());
    return () => cancelAnimationFrame(paint);
  }, [isVisible, sessionPty, visibleFrame]);

  // The renderer store can survive while the main process replaces a PTY.
  // Ask the main-process registry once this exact visible terminal is ready so
  // an old exit banner is cleared immediately instead of waiting for another
  // terminal event. A retained output consumer is already authoritative proof
  // that this frontend is attached; hot task switches must not add another IPC
  // probe before showing the cached terminal.
  useEffect(() => {
    if (
      !shouldProbeConversationSession({
        isVisible,
        sessionId,
        sessionStatus,
        sessionPty,
      })
    ) {
      return;
    }
    void conversations.reconcileSessionLiveness(conversation.data.id);
  }, [conversation.data.id, conversations, isVisible, sessionId, sessionPty, sessionStatus]);

  // Resume the PTY when visible + ready (once per session id).
  useEffect(() => {
    if (!isVisible) {
      lastAutoResumePtyRef.current = null;
      suppressNextAutoResumeRef.current = false;
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
    if (suppressNextAutoResumeRef.current) {
      suppressNextAutoResumeRef.current = false;
      lastAutoResumePtyRef.current = sessionPty;
      return;
    }
    lastAutoResumePtyRef.current = sessionPty;
    const initialSize = getResumeInitialSize(sessionPty, terminalContainerRef.current);
    log.debug('[conversation-session] resume requested', {
      projectId,
      taskId,
      conversationId: conversation.data.id,
      sessionId,
      initialSize: initialSize ?? null,
    });
    void conversations.resumeConversation(conversation.data.id, initialSize).then((running) => {
      log.debug('[conversation-session] resume settled', {
        projectId,
        taskId,
        conversationId: conversation.data.id,
        sessionId,
        running,
      });
      if (!running && lastAutoResumePtyRef.current === sessionPty) {
        if (conversation.data.sessionSource?.runtimeId === 'codex') {
          // The main process rejected an imported session before spawning a
          // replacement (for example, another Codex window still owns its
          // writer). Reconnect once to restore the rollout-history snapshot,
          // then keep that replacement PTY read-only until an explicit retry.
          suppressNextAutoResumeRef.current = true;
          void session.reconnect().catch((error) => {
            suppressNextAutoResumeRef.current = false;
            lastAutoResumePtyRef.current = null;
            log.debug('[conversation-session] history restore failed', {
              projectId,
              taskId,
              conversationId: conversation.data.id,
              error,
            });
          });
        } else {
          lastAutoResumePtyRef.current = null;
        }
      }
    });
  }, [
    conversation,
    conversations,
    isVisible,
    projectId,
    session,
    sessionId,
    sessionPty,
    sessionStatus,
    taskId,
  ]);

  const markConversationSubmitted = (forceWorking = false) => {
    conversation.setWorking({ force: forceWorking });
    void conversations.touchConversation(conversation.data.id);
    void getTaskStore(projectId, taskId)?.setNeedsReview(false);
  };
  const onSubmittedInput = (_message: string, isTaskInput: boolean) => {
    if (isTaskInput || agentStatus !== 'awaiting-input') return;
    markConversationSubmitted(true);
  };
  const onEnterPress = () => markConversationSubmitted(agentStatus === 'awaiting-input');
  const onInterruptPress = () => conversation.clearWorking();

  const [isRestarting, setIsRestarting] = useState(false);
  const handleReloadExitedSession = () => {
    if (isRestarting) return;
    const pty = conversation.session.pty;
    const initialSize = pty ? getResumeInitialSize(pty, terminalContainerRef.current) : undefined;
    setIsRestarting(true);
    const restart =
      conversation.data.sessionSource?.runtimeId === 'codex'
        ? conversations.resumeConversation(conversation.data.id, initialSize)
        : conversations.restartConversation(conversation.data.id, initialSize);
    void restart.finally(() => setIsRestarting(false));
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
      onOpen: (target) => {
        const { absolutePath, line, column, isDirectory } = target;
        const destination = getTerminalFileLinkInternalDestination(target, {
          sshConnectionId: remoteConnectionId,
        });
        if (destination?.placement === 'workspace') {
          provisioned.taskView.tabManager.openFileInSidebar(destination.path, { line, column });
          provisioned.taskView.setSidebarCollapsed(false);
          return;
        }
        if (destination?.placement === 'global') {
          void openTerminalGlobalFileInYoda(destination.path);
          return;
        }
        if (absolutePath) {
          void rpc.app.openIn(
            buildFilePathDefaultOpenRequest({
              absolutePath,
              kind: isDirectory ? 'directory' : 'file',
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
  const canonicalFrameVisible = visibleFrame.pty === sessionPty && visibleFrame.ready;

  const [startDebugCopied, setStartDebugCopied] = useState(false);
  const startDebugCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (startDebugCopyResetRef.current) clearTimeout(startDebugCopyResetRef.current);
    },
    []
  );
  const handleCopyStartDebugInfo = () => {
    const { data, session: s, status, sessionExited } = conversation;
    const lines = [
      'Yoda — agent session terminal preparation failed',
      `time: ${new Date().toISOString()}`,
      `runtime: ${agentConfig[data.runtimeId]?.name ?? data.runtimeId} (${data.runtimeId})`,
      `conversation: ${data.id}`,
      `task: ${data.taskId}`,
      `project: ${data.projectId}`,
      `ptySession: ${s.sessionId}`,
      `ptyStatus: ${s.status}`,
      `ptyError: ${s.connectionError ?? 'n/a'}`,
      `agentStatus: ${status}`,
      `sessionExited: ${sessionExited}`,
      `visible: ${isVisible}`,
      `target: ${remoteConnectionId ? `ssh:${remoteConnectionId}` : 'local'}`,
      `workspace: ${provisioned.path}`,
      `createdAt: ${data.createdAt ?? 'n/a'}`,
      `lastInteractedAt: ${data.lastInteractedAt ?? 'n/a'}`,
    ];
    void navigator.clipboard.writeText(lines.join('\n'));
    setStartDebugCopied(true);
    if (startDebugCopyResetRef.current) clearTimeout(startDebugCopyResetRef.current);
    startDebugCopyResetRef.current = setTimeout(() => setStartDebugCopied(false), 1500);
  };
  const handleRetryStart = () => {
    void session.connect().catch(() => {});
  };

  // Keep the terminal shell mounted while route visibility catches up. The
  // effects above still gate connect/resume demand on isVisible, so a brief
  // route transition cannot blank and remount the visual surface.
  if (!sessionId || session?.status !== 'ready' || !session.pty) {
    const hasStartError = Boolean(session?.connectionError);
    return (
      <ConversationSessionPendingState
        title={conversation.data.title}
        heading={
          hasStartError
            ? t('tasks.conversations.startingErrorTitle')
            : t('tasks.conversations.startingTitle')
        }
        description={
          hasStartError
            ? t('tasks.conversations.startingErrorDescription')
            : t('tasks.conversations.startingDescription')
        }
        error={
          hasStartError
            ? {
                retryLabel: t('common.retry'),
                onRetry: handleRetryStart,
                copyDebugLabel: t('common.copyDebugInfo'),
                debugCopiedLabel: t('common.debugInfoCopied'),
                debugCopied: startDebugCopied,
                onCopyDebug: handleCopyStartDebugInfo,
              }
            : undefined
        }
      />
    );
  }

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
          pasteImagesAsPaths={attachImagesAsPaths}
          remoteConnectionId={remoteConnectionId}
          fileLinks={fileLinks}
          webLinks={webLinks}
        />
        {!canonicalFrameVisible ? (
          <div className="absolute inset-0 z-10 flex bg-background">
            <ConversationSessionPendingState
              title={conversation.data.title}
              heading={t('tasks.conversations.startingTitle')}
              description={t('tasks.conversations.startingDescription')}
            />
          </div>
        ) : null}
        {conversation.sessionExited && !conversation.sessionExitNoticeDismissed ? (
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
                  {t('tasks.conversations.sessionStopped')}
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
                disabled={isRestarting}
                className="h-7 gap-1.5"
              >
                {isRestarting ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="size-3.5" aria-hidden />
                )}
                {t(
                  isRestarting
                    ? 'tasks.conversations.continuingConversation'
                    : 'tasks.conversations.continueConversation'
                )}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => conversation.dismissSessionExitNotice()}
                className="shrink-0 text-foreground-passive"
                aria-label={t('common.close')}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
