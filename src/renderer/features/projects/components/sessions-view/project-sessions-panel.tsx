import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import {
  conversationArchivedChannel,
  conversationMovedChannel,
  conversationRenamedChannel,
  conversationUnarchivedChannel,
} from '@shared/events/conversationEvents';
import { tabDragSource } from '@renderer/app/tab-drag';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { asProvisioned, getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import {
  getProjectSessionTaskArchivedAt,
  openProjectSessionConversation,
} from './project-session-open';

const projectSessionsQueryKey = (projectId: string) => ['project-sessions', projectId] as const;

function getConversationSortTime(conversation: Conversation): number {
  const raw =
    conversation.archivedAt ??
    conversation.lastInteractedAt ??
    conversation.updatedAt ??
    conversation.createdAt ??
    '';
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

const ProjectSessionRow = observer(function ProjectSessionRow({
  conversation,
}: {
  conversation: Conversation;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const task = getTaskManagerStore(conversation.projectId)?.tasks.get(conversation.taskId);
  const taskName =
    task?.data.name ??
    t('projects.sessionsView.taskFallback', { id: conversation.taskId.slice(0, 8) });
  const liveConversation = asProvisioned(task)?.conversations.conversations.get(conversation.id);
  const taskArchivedAt = getProjectSessionTaskArchivedAt(conversation);
  const isArchived = Boolean(conversation.archivedAt || taskArchivedAt);
  const config = agentConfig[conversation.runtimeId];
  const title = conversation.title.trim() || conversation.id;
  const interactedAt =
    conversation.archivedAt ??
    conversation.lastInteractedAt ??
    conversation.updatedAt ??
    conversation.createdAt ??
    '';

  const handleOpen = async () => {
    await openProjectSessionConversation(conversation, navigate);
  };

  return (
    <button
      type="button"
      className={cn(
        'group flex h-10 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none transition-colors',
        'hover:border-border hover:bg-background-1 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring'
      )}
      title={`${title} · ${taskName}`}
      aria-label={t('projects.sessionsView.openSession', { title })}
      onClick={() =>
        void handleOpen().catch((error: unknown) => {
          log.warn('ProjectSessionsPanel: failed to open session', {
            conversationId: conversation.id,
            error,
          });
        })
      }
      {...(!isArchived
        ? tabDragSource(() => ({
            kind: 'conversation-transfer',
            projectId: conversation.projectId,
            sourceTaskId: conversation.taskId,
            conversationId: conversation.id,
          }))
        : {})}
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
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm text-foreground',
          isArchived && 'text-foreground-passive line-through'
        )}
      >
        {title}
      </span>
      {isArchived && (
        <span className="shrink-0 rounded bg-background-quaternary px-1.5 py-0.5 text-[10px] text-foreground/50">
          {t('projects.archived')}
        </span>
      )}
      <span className="hidden min-w-24 max-w-44 truncate text-xs text-foreground-muted sm:block">
        {taskName}
      </span>
      <span className="flex min-w-12 shrink-0 justify-end text-xs text-foreground-passive">
        {liveConversation?.indicatorStatus ? (
          <AgentStatusIndicator status={liveConversation.indicatorStatus} disableTooltip />
        ) : (
          <RelativeTime value={interactedAt} compact />
        )}
      </span>
    </button>
  );
});

export const ProjectSessionsPanel = observer(function ProjectSessionsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    params: { projectId },
  } = useParams('project');
  const project = asMounted(getProjectStore(projectId));
  const queryKey = useMemo(() => projectSessionsQueryKey(projectId), [projectId]);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const conversations = await rpc.conversations.getConversations();
      return conversations.filter((conversation) => conversation.projectId === projectId);
    },
    enabled: Boolean(project),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const offRenamed = events.on(conversationRenamedChannel, (event) => {
      if (event.projectId !== projectId) return;
      queryClient.setQueryData<Conversation[]>(queryKey, (current) =>
        current?.map((conversation) =>
          conversation.id === event.conversationId
            ? { ...conversation, title: event.title }
            : conversation
        )
      );
    });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey });
    };
    const offArchived = events.on(conversationArchivedChannel, (event) => {
      if (event.projectId !== projectId) return;
      refresh();
    });
    const offUnarchived = events.on(conversationUnarchivedChannel, (event) => {
      if (event.projectId !== projectId) return;
      refresh();
    });
    const offMoved = events.on(conversationMovedChannel, (event) => {
      if (event.conversation.projectId !== projectId) return;
      refresh();
    });

    return () => {
      offRenamed();
      offArchived();
      offUnarchived();
      offMoved();
    };
  }, [projectId, queryClient, queryKey]);

  const conversations = useMemo(
    () => [...(data ?? [])].sort((a, b) => getConversationSortTime(b) - getConversationSortTime(a)),
    [data]
  );

  if (!project) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-6 pt-6">
        <div className="flex shrink-0 items-center justify-between border-b border-border pb-3">
          <h2 className="text-sm font-medium text-foreground">
            {t('tasks.conversations.sessions')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('projects.sessionsView.count', { count: conversations.length })}
          </span>
        </div>

        {isLoading && conversations.length === 0 ? (
          <EmptyState label={t('common.loading')} />
        ) : error ? (
          <EmptyState label={t('common.error')} description={String(error)} />
        ) : conversations.length === 0 ? (
          <EmptyState
            label={t('projects.sessionsView.emptyTitle')}
            description={t('projects.sessionsView.emptyDescription')}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <div className="flex flex-col gap-1">
              {conversations.map((conversation) => (
                <ProjectSessionRow key={conversation.id} conversation={conversation} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
