import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { DockedSessionHistory } from '@renderer/features/tasks/conversations/session-history-panel';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { splitViewStore } from '@renderer/features/tasks/split-view/split-view-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/lib/pty/pane-sizing-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import type { ConversationStore } from './conversation-manager';
import { ConversationSession } from './conversation-session';

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
  const conversationStores = Array.from(conversations.conversations.values()).sort((a, b) => {
    const aTime = a.data.lastInteractedAt ? Date.parse(a.data.lastInteractedAt) : 0;
    const bTime = b.data.lastInteractedAt ? Date.parse(b.data.lastInteractedAt) : 0;
    return bTime - aTime;
  });

  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--xterm-bg)]">
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-2 pt-2">
        <div
          ref={containerRef}
          tabIndex={-1}
          className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden outline-none"
          onFocus={() => {
            if (isActive) provisioned.taskView.setFocusedRegion('main');
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
