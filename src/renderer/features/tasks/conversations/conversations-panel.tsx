import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import { DockedSessionHistory } from '@renderer/features/tasks/conversations/session-history-panel';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { log } from '@renderer/utils/logger';
import { SessionOpeningSurface } from '../components/session-opening-surface';
import type { ConversationStore } from './conversation-manager';
import { ConversationSession } from './conversation-session';
import { isConversationSurfaceVisible } from './conversation-surface-visibility';
import { ConversationTree } from './conversation-tree';
import { useArchivedConversations } from './use-archived-conversations';

export { getResumeInitialSize } from './conversation-session';

export const ConversationsPanel = observer(function ConversationsPanel({
  forceVisible = false,
}: {
  /** Detached task windows are outside the main workspace route but still own a visible session. */
  forceVisible?: boolean;
}) {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const { params } = useParams('task');
  const provisioned = useRequireProvisionedTask();
  const { conversations } = provisioned;
  const { tabManager: tm } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');
  const isActive = useIsActiveTask(taskId);
  // Split-view extra panes are visible but not the routed (active) task. They
  // still need their PTY session resumed so input can be sent — gating resume on
  // isActive alone leaves comparison panes dead (can't send). Focus, however,
  // stays tied to isActive so extra panes don't steal the keyboard.
  const isVisible = isConversationSurfaceVisible({
    isActiveTask: isActive,
    isSplitView: splitViewStore.has(taskId),
    forceVisible,
  });
  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

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

  // Build session ID list for PaneSizingProvider (all open conversation tabs).
  const allSessionIds = useMemo(() => {
    return tm.resolvedTabs
      .filter((tab) => tab.kind === 'conversation')
      .map((tab) => tab.store.session.sessionId)
      .filter(Boolean) as string[];
  }, [tm.resolvedTabs]);

  const activeConversation: ConversationStore | undefined = tm.activeConversation;
  const activeDescriptor = tm.activeDescriptor;
  const routeConversationId =
    params.tab?.kind === 'conversation' ? params.tab.conversationId : undefined;
  // A tab can be selected before its conversation store arrives from the
  // manager snapshot. Keep the main surface stable during that short window;
  // falling through to the list makes the panel visibly jump before the PTY
  // can take over.
  const isResolvingActiveConversation =
    activeDescriptor?.kind === 'conversation' && !activeConversation;
  const hasConversationTabs = tm.resolvedTabs.some((tab) => tab.kind === 'conversation');
  const conversationStores = Array.from(conversations.conversations.values());
  const archivedConversations = useArchivedConversations(projectId, taskId);
  const conversationCount = conversationStores.length + archivedConversations.length;
  const isResolvingRouteConversation =
    routeConversationId !== undefined &&
    (tm.activeConversationId !== routeConversationId || !activeConversation);
  // A target-less task entry resolves its restored/preferred session in
  // TopLevelTabSync after the first ready render. Hold the same opening surface
  // during that handoff instead of briefly showing the conversation list.
  const isResolvingTaskSession =
    params.tab === undefined &&
    !hasConversationTabs &&
    (conversationStores.length > 0 || !conversations.hasAuthoritativeSnapshot);
  const isResolvingConversation =
    isResolvingActiveConversation || isResolvingRouteConversation || isResolvingTaskSession;

  // Sorting the IDs makes a state transition easy to compare in the console,
  // but is intentionally debug-only so normal renders keep the existing cost.
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
  const conversationIds = isDebugTracing
    ? conversationStores
        .map((conversation) => conversation.data.id)
        .sort()
        .join(',')
    : '';
  const archivedConversationIds = isDebugTracing
    ? archivedConversations
        .map((conversation) => conversation.id)
        .sort()
        .join(',')
    : '';
  const conversationTabIds = isDebugTracing
    ? tm.resolvedTabs
        .flatMap((tab) => (tab.kind === 'conversation' ? [tab.conversationId] : []))
        .sort()
        .join(',')
    : '';
  const surface = isResolvingConversation
    ? 'resolving'
    : !hasConversationTabs
      ? conversationCount > 0
        ? 'list'
        : 'empty'
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
        isResolvingActiveConversation,
        isResolvingRouteConversation,
        isResolvingTaskSession,
        surface,
        conversationIds,
        archivedConversationIds,
        conversationTabIds,
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
      resolving: {
        activeConversation: isResolvingActiveConversation,
        routeConversation: isResolvingRouteConversation,
        taskSession: isResolvingTaskSession,
      },
      conversationIds,
      archivedConversationIds,
      conversationTabIds,
    });
  }, [
    activeConversation?.session.sessionId,
    activeDescriptor,
    archivedConversationIds,
    conversationIds,
    conversationTabIds,
    conversations.hasAuthoritativeSnapshot,
    forceVisible,
    isActive,
    isResolvingActiveConversation,
    isResolvingRouteConversation,
    isResolvingTaskSession,
    isVisible,
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--xterm-bg)]">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-2 pt-2">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
          onFocus={() => {
            if (isActive) provisioned.taskView.setFocusedRegion('main');
          }}
        >
          <PaneSizingProvider
            paneId="conversations"
            sessionIds={allSessionIds}
            activeSessionId={activeConversation?.session.sessionId ?? null}
          >
            {isResolvingConversation ? (
              <SessionOpeningSurface
                surface="conversation-session-pending"
                heading={t('tasks.conversations.startingTitle')}
                description={t('tasks.conversations.startingDescription')}
                progressMessage={t('tasks.conversations.startingDescription')}
              />
            ) : !hasConversationTabs ? (
              conversationCount > 0 ? (
                <ConversationSessionList
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
                {activeConversation ? (
                  <ConversationSession
                    conversation={activeConversation}
                    isVisible={isVisible}
                    autoFocus={autoFocus}
                  />
                ) : null}
              </div>
            )}
          </PaneSizingProvider>
        </div>
      </div>
      <DockedSessionHistory />
    </div>
  );
});

const ConversationSessionList = observer(function ConversationSessionList({
  conversations,
  archivedConversations,
  activeConversationId,
  title,
  createLabel,
  createAction,
  onOpen,
  onArchivedRestored,
}: {
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
