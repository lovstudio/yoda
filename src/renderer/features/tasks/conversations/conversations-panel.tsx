import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import { TaskRoomChat } from '@renderer/features/agent-room/task-room-chat';
import { taskRoomQueryKey } from '@renderer/features/agent-room/team-room-queries';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { DockedSessionHistory } from '@renderer/features/tasks/conversations/session-history-panel';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import type { ProvisionedTask } from '@renderer/features/tasks/stores/task';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import type { FrontendPty } from '@renderer/lib/pty/pty';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { taskOpenTransitionStore } from '../task-open-transition-store';
import type { ConversationManagerStore, ConversationStore } from './conversation-manager';
import { ConversationSession } from './conversation-session';
import { isConversationSurfaceVisible } from './conversation-surface-visibility';
import { ConversationTree } from './conversation-tree';
import { useArchivedConversations } from './use-archived-conversations';

export { getResumeInitialSize } from './conversation-session';

export const ConversationsPanel = observer(function ConversationsPanel({
  forceVisible = false,
  bare = false,
}: {
  /** Detached task windows are outside the main workspace route but still own a visible session. */
  forceVisible?: boolean;
  /**
   * Show the agent TUI alone, without Yoda's own chrome around it. The
   * standalone kanban board tiles many sessions at once and each card is meant
   * to be the terminal itself.
   */
  bare?: boolean;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const { params } = useParams('task');
  const provisioned = useRequireProvisionedTask();
  const { conversations } = provisioned;
  const { tabManager: tm } = provisioned.taskView;
  const isActive = useIsActiveTask(taskId);
  const isTaskOpenStaging = taskOpenTransitionStore.isPending(projectId, taskId);
  const { isLoading: isInterfaceSettingsLoading } = useAppSettingsKey('interface');
  // Split-view extra panes are visible but not the routed (active) task. They
  // still need their PTY session resumed so input can be sent — gating resume on
  // isActive alone leaves comparison panes dead (can't send). Focus, however,
  // stays tied to isActive so extra panes don't steal the keyboard.
  const isVisible =
    isConversationSurfaceVisible({
      isActiveTask: isActive,
      isSplitView: splitViewStore.has(taskId),
      forceVisible,
    }) && !isTaskOpenStaging;
  const autoFocus = isActive && !isTaskOpenStaging && provisioned.taskView.focusedRegion === 'main';

  const activeConversation: ConversationStore | undefined = tm.activeConversation;
  const activeDescriptor = tm.activeDescriptor;
  const conversationLoadError = conversations.loadError;
  const hasConversationLoadError =
    conversationLoadError !== null && conversationLoadError !== undefined;
  const routeConversationId =
    params.tab?.kind === 'conversation' ? params.tab.conversationId : undefined;
  // A tab can be selected before its conversation store arrives from the
  // manager snapshot. Keep the main surface stable during that short window;
  // falling through to the list makes the panel visibly jump before the PTY
  // can take over.
  const isResolvingActiveConversation =
    activeDescriptor?.kind === 'conversation' && !activeConversation;
  // The visible agents surface either has an active conversation descriptor or
  // no active tab at all. Only repair malformed/stale tab state by scanning in
  // the latter case, keeping the normal session path independent of tab count.
  const hasConversationTabs =
    activeDescriptor?.kind === 'conversation' ||
    (!activeDescriptor &&
      tm.tabOrder.some((tabId) => tm.entries.get(tabId)?.kind === 'conversation'));
  const isResolvingRouteConversation =
    routeConversationId !== undefined &&
    (tm.activeConversationId !== routeConversationId || !activeConversation);
  // A target-less task entry resolves its restored/preferred session in
  // TopLevelTabSync after the first ready render. Hold the same opening surface
  // during that handoff instead of briefly showing the conversation list.
  const isResolvingTaskSession =
    params.tab === undefined &&
    !hasConversationTabs &&
    (conversations.conversations.size > 0 || !conversations.hasAuthoritativeSnapshot);
  const isResolvingConversation =
    !hasConversationLoadError &&
    (isResolvingActiveConversation || isResolvingRouteConversation || isResolvingTaskSession);
  // A route can point at the next conversation while the tab manager still
  // exposes the previous active store. Do not let that stale session retain
  // resize ownership or mount auxiliary UI beneath the opening surface. Hidden
  // and staged panes stay registered for measurement but withhold backend
  // resize ownership until the destination becomes visible.
  const activeSessionId =
    isVisible && !isResolvingConversation && !hasConversationLoadError
      ? (activeConversation?.session.sessionId ?? null)
      : null;
  const activeSession =
    isResolvingConversation || hasConversationLoadError
      ? null
      : (activeConversation?.session ?? null);
  const activePty = activeSession?.status === 'ready' ? (activeSession.pty ?? null) : null;
  const hasSessionStartError = Boolean(activeSession?.connectionError);
  const hasSessionExited = Boolean(!isResolvingConversation && activeConversation?.sessionExited);
  const isExternalWriter = activeConversation?.sessionResumeBlockReason === 'external-writer';
  const sessionFramePainted = usePostPaintSessionFrame(
    !isTaskOpenStaging && !hasSessionStartError,
    activePty
  );
  const isSessionOpening =
    !hasConversationLoadError &&
    (isResolvingConversation ||
      Boolean(
        activeConversation &&
          !hasSessionStartError &&
          !hasSessionExited &&
          !isExternalWriter &&
          !sessionFramePainted
      ));
  const sessionOpeningOwner = useRef(Symbol(`session-opening:${projectId}:${taskId}`));

  // TaskMainPanel owns the sole ordinary opening surface. Publish readiness in
  // layout timing so its full-panel overlay is committed before the browser
  // can paint a terminal-only intermediate frame. Connection errors clear this
  // intent and remain visible through ConversationSession's detail surface.
  useLayoutEffect(() => {
    const owner = sessionOpeningOwner.current;
    taskOpenTransitionStore.reportSessionOpening(projectId, taskId, owner, isSessionOpening);
    taskOpenTransitionStore.reportSessionError(
      projectId,
      taskId,
      owner,
      hasSessionStartError || hasConversationLoadError
    );
    return () => {
      taskOpenTransitionStore.clearSessionOpening(projectId, taskId, owner);
      taskOpenTransitionStore.clearSessionError(projectId, taskId, owner);
    };
  }, [hasConversationLoadError, hasSessionStartError, isSessionOpening, projectId, taskId]);
  // PaneSizingProvider only validates resize ownership for the active session.
  // Supplying every open conversation used to resolve every tab before the
  // terminal could mount; one stable O(1) entry is sufficient here.
  const paneSessionIds = useMemo(
    () => (activeSessionId ? [activeSessionId] : []),
    [activeSessionId]
  );

  const isDebugTracing = log.level === 'debug';
  // Keep debug telemetry structural. File/diff route targets can contain a
  // workspace path or remote metadata, neither of which helps diagnose this
  // conversation surface.
  const routeTabTraceKey =
    !isDebugTracing || !params.tab
      ? ''
      : params.tab.kind === 'conversation'
        ? `conversation:${params.tab.conversationId}`
        : params.tab.kind === 'room-member'
          ? `room-member:${params.tab.memberId}`
          : params.tab.kind;
  const surface = hasConversationLoadError
    ? 'load-error'
    : isResolvingConversation
      ? 'resolving'
      : !hasConversationTabs
        ? 'landing'
        : activeConversation
          ? 'session'
          : 'blank';
  const panelStateTraceKey = isDebugTracing
    ? [
        projectId,
        taskId,
        isActive,
        isVisible,
        forceVisible,
        provisioned.taskView.focusedRegion,
        routeTabTraceKey,
        activeDescriptor?.tabId ?? '',
        activeDescriptor?.kind ?? '',
        tm.activeTabId ?? '',
        tm.activeConversationId ?? '',
        activeConversation?.session.sessionId ?? '',
        conversations.hasAuthoritativeSnapshot,
        hasConversationLoadError,
        isResolvingActiveConversation,
        isResolvingRouteConversation,
        isResolvingTaskSession,
        surface,
      ].join('\u001f')
    : '';
  const lastPanelStateTraceKey = useRef<string | null>(null);

  useEffect(() => {
    if (!panelStateTraceKey || lastPanelStateTraceKey.current === panelStateTraceKey) return;
    lastPanelStateTraceKey.current = panelStateTraceKey;
    log.debug('[conversation-panel] state', {
      projectId,
      taskId,
      surface,
      isActive,
      isVisible,
      forceVisible,
      focusedRegion: provisioned.taskView.focusedRegion,
      routeTab: routeTabTraceKey || null,
      activeTabId: tm.activeTabId ?? null,
      activeDescriptor: activeDescriptor
        ? { tabId: activeDescriptor.tabId, kind: activeDescriptor.kind }
        : null,
      activeConversationId: tm.activeConversationId ?? null,
      activeSessionId: activeConversation?.session.sessionId ?? null,
      hasAuthoritativeSnapshot: conversations.hasAuthoritativeSnapshot,
      hasLoadError: hasConversationLoadError,
      resolving: {
        activeConversation: isResolvingActiveConversation,
        routeConversation: isResolvingRouteConversation,
        taskSession: isResolvingTaskSession,
      },
    });
  }, [
    activeConversation?.session.sessionId,
    activeDescriptor,
    conversations.hasAuthoritativeSnapshot,
    forceVisible,
    isActive,
    isResolvingActiveConversation,
    isResolvingRouteConversation,
    isResolvingTaskSession,
    isVisible,
    hasConversationLoadError,
    panelStateTraceKey,
    projectId,
    provisioned.taskView.focusedRegion,
    routeTabTraceKey,
    surface,
    taskId,
    tm,
  ]);

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      data-conversations-panel-root
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--xterm-bg)]"
    >
      <div
        className={cn(
          'flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-2',
          bare ? 'py-2' : 'pt-2'
        )}
      >
        <div
          ref={containerRef}
          tabIndex={-1}
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
          onFocus={() => {
            if (isActive) provisioned.taskView.setFocusedRegion('main');
          }}
        >
          <PaneSizingProvider
            paneId={`conversations:${projectId}:${taskId}`}
            sessionIds={paneSessionIds}
            activeSessionId={activeSessionId}
            registrationEnabled={!isInterfaceSettingsLoading}
          >
            {hasConversationLoadError ? (
              <ConversationLoadErrorSurface
                error={conversationLoadError}
                conversations={conversations}
              />
            ) : isResolvingConversation ? (
              <div aria-hidden className="min-h-0 min-w-0 flex-1" />
            ) : !hasConversationTabs ? (
              <ConversationLandingSurface projectId={projectId} taskId={taskId} />
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {activeConversation ? (
                  <ConversationSession
                    conversation={activeConversation}
                    isVisible={isVisible}
                    autoFocus={autoFocus}
                    loadingSurface="external"
                  />
                ) : null}
              </div>
            )}
          </PaneSizingProvider>
        </div>
      </div>
      {/*
       * Reserve the dock's geometry from the moment this pane is known to be
       * heading for a session, including while task-open staging measures it.
       * Mounting it only after the conversation resolves made staging bind the
       * backend TUI to a grid that was ~10 rows too tall, then shrink the pane
       * one layout pass later: the second SIGWINCH makes the agent reprint its
       * whole screen (duplicate banners in scrollback) and leaves the backend
       * and xterm on different row counts until an unrelated resize.
       */}
      {!bare && !hasConversationLoadError && (isResolvingConversation || activeConversation) ? (
        <DockedSessionHistory
          key={activeConversation ? `${taskId}:${activeConversation.data.id}` : `${taskId}:pending`}
          active={
            !isResolvingConversation &&
            activeConversation !== undefined &&
            (sessionFramePainted || isExternalWriter)
          }
        />
      ) : null}
    </div>
  );
});

function ConversationLoadErrorSurface({
  error,
  conversations,
}: {
  error: unknown;
  conversations: ConversationManagerStore;
}) {
  const { t } = useTranslation();
  const [isRetrying, setIsRetrying] = useState(false);
  const description = error instanceof Error ? error.message : String(error);
  const handleRetry = () => {
    if (isRetrying) return;
    setIsRetrying(true);
    void conversations
      .retryLoad()
      .catch(() => {})
      .finally(() => setIsRetrying(false));
  };

  return (
    <EmptyState
      label={t('common.error')}
      description={description}
      action={
        <Button size="sm" variant="outline" disabled={isRetrying} onClick={handleRetry}>
          {t('common.retry')}
        </Button>
      }
    />
  );
}

/** Wait one browser paint beyond the PTY's canonical frame before revealing its final surface. */
function usePostPaintSessionFrame(enabled: boolean, pty: FrontendPty | null): boolean {
  const reveal = useMemo(
    () => ({ enabled, pty, token: Symbol('session-history-reveal') }),
    [enabled, pty]
  );
  const revealToken = reveal.token;
  const [paintedToken, setPaintedToken] = useState<symbol | null>(null);

  useLayoutEffect(() => {
    let subscribed = true;
    let revealFrame: number | null = null;
    let revealed = false;
    if (!enabled || !pty) return;

    const unsubscribe = pty.subscribeVisibleFrameState((ready) => {
      if (!subscribed) return;
      if (revealFrame !== null) {
        cancelAnimationFrame(revealFrame);
        revealFrame = null;
      }
      if (!ready) {
        revealed = false;
        setPaintedToken(null);
        return;
      }
      if (revealed) return;
      revealFrame = requestAnimationFrame(() => {
        revealFrame = null;
        if (!subscribed) return;
        revealed = true;
        setPaintedToken(revealToken);
      });
    });

    return () => {
      subscribed = false;
      if (revealFrame !== null) cancelAnimationFrame(revealFrame);
      unsubscribe();
    };
  }, [enabled, pty, revealToken]);

  return enabled && pty !== null && paintedToken === revealToken;
}

const ConversationLandingSurface = observer(function ConversationLandingSurface({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const { t } = useTranslation();
  const provisioned = useRequireProvisionedTask();
  const { conversations } = provisioned;
  const { tabManager: tm } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');
  const conversationStores = Array.from(conversations.conversations.values());
  const archivedConversations = useArchivedConversations(projectId, taskId);
  const conversationCount = conversationStores.length + archivedConversations.length;
  // A team-room task works through its group chat, so that IS the task's own
  // surface — the same way a single-session task lands on its session.
  const { data: teamRoom } = useQuery({
    queryKey: taskRoomQueryKey(projectId, taskId),
    queryFn: () => rpc.teamRooms.getRoomForTask(projectId, taskId),
  });

  const handleCreate = () => {
    log.debug('[conversation-panel] create requested', { projectId, taskId });
    showNewConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationIds }) => {
        const conversationId = conversationIds[0];
        if (conversationId) {
          log.debug('[conversation-panel] create succeeded; opening conversation', {
            projectId,
            taskId,
            conversationId,
          });
          tm.openConversation(conversationId);
        }
        provisioned.taskView.setFocusedRegion('main');
      },
    });
  };

  if (teamRoom) return <TaskRoomChat projectId={projectId} taskId={taskId} />;

  if (conversationCount === 0) {
    return (
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
    );
  }

  return (
    <ConversationSessionList
      owner={{ projectId, taskId, provisioned }}
      conversations={conversationStores}
      archivedConversations={archivedConversations}
      activeConversationId={tm.activeConversationId}
      title={t('tasks.conversations.sessions')}
      createLabel={t('tasks.conversations.createConversation')}
      createAction={handleCreate}
      onOpen={(conversationId) => {
        log.debug('[conversation-panel] open requested', {
          projectId,
          taskId,
          conversationId,
          activeConversationId: tm.activeConversationId ?? null,
        });
        tm.openConversation(conversationId);
        provisioned.taskView.setFocusedRegion('main');
      }}
      onArchivedRestored={() => provisioned.taskView.setFocusedRegion('main')}
    />
  );
});

const ConversationSessionList = observer(function ConversationSessionList({
  owner,
  conversations,
  archivedConversations,
  activeConversationId,
  title,
  createLabel,
  createAction,
  onOpen,
  onArchivedRestored,
}: {
  owner: { projectId: string; taskId: string; provisioned?: ProvisionedTask };
  conversations: ConversationStore[];
  archivedConversations: Conversation[];
  activeConversationId?: string | null;
  title: string;
  createLabel: string;
  createAction: () => void;
  onOpen: (conversationId: string) => void;
  onArchivedRestored: (conversationId: string) => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          <span className="shrink-0 text-xs tabular-nums text-foreground-passive">
            {conversations.length + archivedConversations.length}
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
          <ConversationTree
            owner={owner}
            activeConversations={conversations}
            archivedConversations={archivedConversations}
            activeConversationId={activeConversationId}
            onOpenActive={onOpen}
            onArchivedRestored={onArchivedRestored}
          />
        </div>
      </div>
    </div>
  );
});
