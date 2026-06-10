import { ArchiveRestore, ChevronRight, GitBranch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Conversation } from '@shared/conversations';
import {
  conversationArchivedChannel,
  conversationUnarchivedChannel,
} from '@shared/events/conversationEvents';
import type { ConversationUsageSummary } from '@shared/stats';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import {
  getTaskStore,
  taskAncestors,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { log } from '@renderer/utils/logger';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';
import { SessionUsageChip } from '../components/session-usage-chip';
import { TaskStatsStrip } from '../components/task-stats-strip';
import { useTaskStats } from '../hooks/useTaskStats';
import { SubtaskList } from './subtask-list';

/**
 * Task overview — the content of the fixed first tab. A task can own MANY
 * sessions; this surface leads with a compact task header and then lists every
 * session for the task. Clicking a session opens its conversation tab.
 */
export const OverviewPanel = observer(function OverviewPanel() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');

  const sessions = Array.from(provisioned.conversations.conversations.values()).sort(
    (a, b) => sessionTime(b.data.lastInteractedAt) - sessionTime(a.data.lastInteractedAt)
  );

  const archived = useArchivedConversations(projectId, taskId);
  const { data: taskStats } = useTaskStats(projectId, taskId);
  const usageByConversation = new Map<string, ConversationUsageSummary>(
    (taskStats?.conversations ?? []).map((usage) => [usage.conversationId, usage])
  );

  const projectName = projectDisplayName(getProjectStore(projectId)) ?? projectId;
  const taskName = taskDisplayName(getTaskStore(projectId, taskId)) ?? taskId;
  const branchName = provisioned.workspace.git.branchName ?? provisioned.taskBranch;
  // Parent chain root-first for the breadcrumb; long chains collapse the middle.
  const ancestors = taskAncestors(projectId, taskId).reverse();
  const breadcrumbAncestors =
    ancestors.length > 3 ? [ancestors[0], null, ancestors[ancestors.length - 1]] : ancestors;

  const handleCreate = () => {
    showNewConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationIds }) => {
        const conversationId = conversationIds[0];
        if (conversationId) tabManager.openConversation(conversationId);
      },
    });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
        <header className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-1 text-xs text-foreground-passive">
            <button
              type="button"
              className="-mx-1 inline-flex min-w-0 items-center rounded px-1 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => navigate('project', { projectId })}
              title={t('sidebar.openProjectDetails')}
              aria-label={t('sidebar.openProjectDetails')}
            >
              <span className="min-w-0 truncate">{projectName}</span>
            </button>
            {breadcrumbAncestors.map((ancestor, index) =>
              ancestor === null ? (
                <span key={`ellipsis-${index}`} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="size-3 shrink-0" />
                  <span aria-hidden>...</span>
                </span>
              ) : (
                <span key={ancestor.data.id} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-3 shrink-0" />
                  <button
                    type="button"
                    className="-mx-1 inline-flex min-w-0 items-center rounded px-1 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onClick={() => navigate('task', { projectId, taskId: ancestor.data.id })}
                    title={ancestor.data.name}
                  >
                    <span className="min-w-0 truncate">{ancestor.data.name}</span>
                  </button>
                </span>
              )
            )}
            <ChevronRight className="size-3 shrink-0" />
            <span className="min-w-0 truncate text-foreground-muted">{taskName}</span>
          </div>
          <h1 className="min-w-0 truncate text-lg font-semibold text-foreground" title={taskName}>
            {taskName}
          </h1>
          {branchName && (
            <div className="flex items-center gap-1.5 text-xs text-foreground-passive">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate font-mono" title={branchName}>
                {branchName}
              </span>
            </div>
          )}
          {taskStats && <TaskStatsStrip stats={taskStats} />}
        </header>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {t('tasks.overview.sessions', { count: sessions.length })}
            </h2>
            <Button size="sm" variant="ghost" onClick={handleCreate}>
              <MessageSquarePlus className="size-4" />
              {t('tasks.tabs.newConversation')}
            </Button>
          </div>

          {sessions.length === 0 ? (
            <EmptyState label={t('tasks.overview.noSessions')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {sessions.map((session) => (
                <SessionRow
                  key={session.data.id}
                  conversationId={session.data.id}
                  usage={usageByConversation.get(session.data.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <SubtaskList projectId={projectId} taskId={taskId} branchName={branchName ?? undefined} />

        {archived.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-foreground-passive">
              {t('tasks.overview.archivedSessions', { count: archived.length })}
            </h2>
            <ul className="flex flex-col gap-1">
              {archived.map((conversation) => (
                <ArchivedSessionRow
                  key={conversation.id}
                  conversation={conversation}
                  usage={usageByConversation.get(conversation.id)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
});

/**
 * Archived conversations are filtered out of the active conversation manager
 * store (and dropped from it on archive events), so the overview fetches them
 * on demand. Re-fetches whenever an archive/unarchive event lands for this task
 * so the two lists stay in sync.
 */
function useArchivedConversations(projectId: string, taskId: string): Conversation[] {
  const [archived, setArchived] = useState<Conversation[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void rpc.conversations
        .getArchivedConversationsForTask(projectId, taskId)
        .then((rows) => {
          if (cancelled) return;
          setArchived(
            rows.sort((a, b) => sessionTime(b.lastInteractedAt) - sessionTime(a.lastInteractedAt))
          );
        })
        .catch((error: unknown) => {
          log.warn('OverviewPanel: failed to load archived conversations', {
            projectId,
            taskId,
            error,
          });
        });
    };

    refresh();
    const offArchived = events.on(conversationArchivedChannel, (event) => {
      if (event.projectId === projectId && event.taskId === taskId) refresh();
    });
    const offUnarchived = events.on(conversationUnarchivedChannel, (event) => {
      if (event.projectId === projectId && event.taskId === taskId) refresh();
    });
    return () => {
      cancelled = true;
      offArchived();
      offUnarchived();
    };
  }, [projectId, taskId]);

  return archived;
}

const SessionRow = observer(function SessionRow({
  conversationId,
  usage,
}: {
  conversationId: string;
  usage?: ConversationUsageSummary;
}) {
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const conversation = provisioned.conversations.conversations.get(conversationId);
  if (!conversation) return null;

  const isActive = tabManager.activeConversationId === conversationId;
  const config = agentConfig[conversation.data.runtimeId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.data.runtimeId,
    conversation.data.title
  );

  return (
    <li>
      <button
        type="button"
        onClick={() => tabManager.openConversation(conversationId)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
          isActive && 'border-border bg-background-2 text-foreground'
        )}
      >
        <span className="shrink-0">
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1 truncate" title={displayTitle}>
          {displayTitle}
        </span>
        <SessionUsageChip usage={usage} />
        {conversation.indicatorStatus ? (
          <AgentStatusIndicator status={conversation.indicatorStatus} disableTooltip />
        ) : (
          <RelativeTime
            value={conversation.data.lastInteractedAt ?? ''}
            className="shrink-0 font-mono text-xs text-foreground-passive"
            compact
          />
        )}
      </button>
    </li>
  );
});

const ArchivedSessionRow = observer(function ArchivedSessionRow({
  conversation,
  usage,
}: {
  conversation: Conversation;
  usage?: ConversationUsageSummary;
}) {
  const { t } = useTranslation();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const [busy, setBusy] = useState(false);

  const config = agentConfig[conversation.runtimeId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.runtimeId,
    conversation.title
  );

  const handleReopen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc.conversations.unarchiveConversation(
        conversation.projectId,
        conversation.taskId,
        conversation.id
      );
      await provisioned.conversations.ensureConversation(conversation.id);
      tabManager.openConversation(conversation.id);
    } catch (error) {
      log.warn('OverviewPanel: failed to reopen archived conversation', {
        conversationId: conversation.id,
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <button
        type="button"
        onClick={handleReopen}
        disabled={busy}
        title={t('tasks.tabs.archiveConversation')}
        className={cn(
          'group flex w-full items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5 text-left text-sm text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground-muted',
          busy && 'opacity-60'
        )}
      >
        <span className="shrink-0 opacity-60">
          <AgentLogo
            logo={config.logo}
            alt={config.alt}
            isSvg={config.isSvg}
            invertInDark={config.invertInDark}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1 truncate line-through decoration-1" title={displayTitle}>
          {displayTitle}
        </span>
        <SessionUsageChip usage={usage} />
        <ArchiveRestore className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        <RelativeTime
          value={conversation.lastInteractedAt ?? ''}
          className="shrink-0 font-mono text-xs text-foreground-passive"
          compact
        />
      </button>
    </li>
  );
});

function sessionTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}
