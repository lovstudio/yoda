import { ChevronRight, GitBranch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { formatConversationTitleForDisplay } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { getTaskStore, taskDisplayName } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { AgentStatusIndicator } from '../components/agent-status-indicator';

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
  const showCreateConversationModal = useShowModal('createConversationModal');

  const sessions = Array.from(provisioned.conversations.conversations.values()).sort(
    (a, b) => sessionTime(b.data.lastInteractedAt) - sessionTime(a.data.lastInteractedAt)
  );

  const projectName = projectDisplayName(getProjectStore(projectId)) ?? projectId;
  const taskName = taskDisplayName(getTaskStore(projectId, taskId)) ?? taskId;
  const branchName = provisioned.workspace.git.branchName ?? provisioned.taskBranch;

  const handleCreate = () => {
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tabManager.openConversation(conversationId);
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
                <SessionRow key={session.data.id} conversationId={session.data.id} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
});

const SessionRow = observer(function SessionRow({ conversationId }: { conversationId: string }) {
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const conversation = provisioned.conversations.conversations.get(conversationId);
  if (!conversation) return null;

  const isActive = tabManager.activeConversationId === conversationId;
  const config = agentConfig[conversation.data.providerId];
  const displayTitle = formatConversationTitleForDisplay(
    conversation.data.providerId,
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

function sessionTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}
