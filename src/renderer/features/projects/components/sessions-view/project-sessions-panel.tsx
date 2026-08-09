import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalAgentSession, ProjectSessionSource } from '@shared/conversations';
import {
  conversationArchivedChannel,
  conversationMovedChannel,
  conversationRenamedChannel,
  conversationUnarchivedChannel,
} from '@shared/events/conversationEvents';
import { tabDragSource } from '@renderer/app/tab-drag';
import {
  projectSessionsQueryKey,
  subscribeProjectTaskQueryInvalidation,
} from '@renderer/features/projects/project-task-query-events';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { asProvisioned, getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { mergeProjectSessionItems, type ProjectSessionItem } from './project-session-items';
import { openProjectSessionConversation } from './project-session-open';

type ProjectSessionsData = {
  conversationSources: ProjectSessionSource[];
  localSessions: LocalAgentSession[];
};

const ProjectSessionRow = observer(function ProjectSessionRow({
  source,
}: {
  source: ProjectSessionSource;
}) {
  const { conversation, taskName, taskArchivedAt } = source;
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const task = getTaskManagerStore(conversation.projectId)?.tasks.get(conversation.taskId);
  const liveConversation = asProvisioned(task)?.conversations.conversations.get(conversation.id);
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
    await openProjectSessionConversation({ ...conversation, taskArchivedAt }, navigate);
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

function LocalAgentSessionRow({
  projectId,
  session,
}: {
  projectId: string;
  session: LocalAgentSession;
}) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const showSession = useShowModal('localAgentSessionModal');
  const config = agentConfig[session.runtimeId];
  const interactedAt = session.updatedAt ?? session.createdAt ?? '';

  const handleOpen = () => {
    showSession({
      projectId,
      session,
      onSuccess: ({ projectId: resultProjectId, taskId, conversationId }) => {
        void openProjectSessionConversation(
          { projectId: resultProjectId, taskId, id: conversationId, taskArchivedAt: null },
          navigate
        );
      },
    });
  };

  return (
    <button
      type="button"
      className={cn(
        'group flex h-10 w-full items-center gap-2 rounded-md border border-transparent px-2 text-left outline-none transition-colors',
        'hover:border-border hover:bg-background-1 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring'
      )}
      title={`${session.title} · ${session.stateRoot}`}
      aria-label={t('projects.sessionsView.previewLocalSession', { title: session.title })}
      onClick={handleOpen}
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
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{session.title}</span>
      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
        {t('projects.sessionsView.localBadge')}
      </span>
      <span className="hidden min-w-24 max-w-44 truncate text-xs text-foreground-muted sm:block">
        {session.providerId || session.runtimeId}
      </span>
      <span className="flex min-w-12 shrink-0 justify-end text-xs text-foreground-passive">
        <RelativeTime value={interactedAt} compact />
      </span>
    </button>
  );
}

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
      const conversationSources = await rpc.conversations.getProjectSessionSources(projectId);
      const localSessions =
        project?.data.type === 'local'
          ? await rpc.conversations.listLocalAgentSessions(project.data.path)
          : [];
      return {
        conversationSources,
        localSessions,
      };
    },
    enabled: Boolean(project),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const offRenamed = events.on(conversationRenamedChannel, (event) => {
      if (event.projectId !== projectId) return;
      queryClient.setQueryData<ProjectSessionsData>(queryKey, (current) =>
        current
          ? {
              ...current,
              conversationSources: current.conversationSources.map((source) =>
                source.conversation.id === event.conversationId
                  ? { ...source, conversation: { ...source.conversation, title: event.title } }
                  : source
              ),
            }
          : current
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
    const offTaskQueries = subscribeProjectTaskQueryInvalidation({
      onProjectSessionsInvalidated: (changedProjectId) => {
        if (changedProjectId === projectId) refresh();
      },
    });

    return () => {
      offRenamed();
      offArchived();
      offUnarchived();
      offMoved();
      offTaskQueries();
    };
  }, [projectId, queryClient, queryKey]);

  const sessions = useMemo(
    () =>
      mergeProjectSessionItems(
        data?.conversationSources.map((source) => source.conversation) ?? [],
        data?.localSessions ?? []
      ),
    [data]
  );
  const sourceByConversationId = useMemo(
    () =>
      new Map(data?.conversationSources.map((source) => [source.conversation.id, source]) ?? []),
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
            {t('projects.sessionsView.count', { count: sessions.length })}
          </span>
        </div>

        {isLoading && sessions.length === 0 ? (
          <EmptyState label={t('common.loading')} />
        ) : error ? (
          <EmptyState label={t('common.error')} description={String(error)} />
        ) : sessions.length === 0 ? (
          <EmptyState
            label={t('projects.sessionsView.emptyTitle')}
            description={t('projects.sessionsView.emptyDescription')}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto py-3">
            <div className="flex flex-col gap-1">
              {sessions.map((item: ProjectSessionItem) => {
                if (item.kind === 'conversation') {
                  const source = sourceByConversationId.get(item.conversation.id);
                  return source ? (
                    <ProjectSessionRow
                      key={`conversation:${item.conversation.id}`}
                      source={source}
                    />
                  ) : null;
                }
                return (
                  <LocalAgentSessionRow
                    key={`local:${item.session.catalogId}`}
                    projectId={projectId}
                    session={item.session}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
