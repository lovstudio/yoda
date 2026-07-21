import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import { DockedSessionHistory } from '@renderer/features/tasks/conversations/session-history-panel';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { ConversationDragHandle } from './conversation-drag-handle';
import type { ConversationStore } from './conversation-manager';
import { ConversationSession } from './conversation-session';
import { ConversationTree } from './conversation-tree';
import { useArchivedConversations } from './use-archived-conversations';

export { getResumeInitialSize } from './conversation-session';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { t } = useTranslation();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { conversations } = provisioned;
  const { tabManager: tm } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');
  const isActive = useIsActiveTask(taskId);
  // Split-view extra panes are visible but not the routed (active) task. They
  // still need their PTY session resumed so input can be sent — gating resume on
  // isActive alone leaves comparison panes dead (can't send). Focus, however,
  // stays tied to isActive so extra panes don't steal the keyboard.
  const isVisible = isActive || splitViewStore.has(taskId);
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
      .filter((tab) => tab.kind === 'conversation')
      .map((tab) => tab.store.session.sessionId)
      .filter(Boolean) as string[];
  }, [tm.resolvedTabs]);

  const activeConversation: ConversationStore | undefined = tm.activeConversation;
  const hasConversationTabs = tm.resolvedTabs.some((tab) => tab.kind === 'conversation');
  const conversationStores = Array.from(conversations.conversations.values());
  const archivedConversations = useArchivedConversations(projectId, taskId);
  const conversationCount = conversationStores.length + archivedConversations.length;

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--xterm-bg)]">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-2 pt-2">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="group/session relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
          onFocus={() => {
            if (isActive) provisioned.taskView.setFocusedRegion('main');
          }}
        >
          {activeConversation ? (
            <ConversationDragHandle
              projectId={projectId}
              taskId={taskId}
              conversationId={activeConversation.data.id}
              className="absolute top-1 right-1 z-30 border border-border/60 bg-background/80 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover/session:opacity-100 hover:opacity-100 focus:opacity-100"
            />
          ) : null}
          <PaneSizingProvider paneId="conversations" sessionIds={allSessionIds}>
            {!hasConversationTabs ? (
              conversationCount > 0 ? (
                <ConversationSessionList
                  conversations={conversationStores}
                  archivedConversations={archivedConversations}
                  activeConversationId={tm.activeConversationId}
                  title={t('tasks.conversations.sessions')}
                  createLabel={t('tasks.conversations.createConversation')}
                  createAction={handleCreate}
                  onOpen={(conversationId) => {
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
