import { useQuery } from '@tanstack/react-query';
import { ChevronRight, GitBranch, MessageSquarePlus, Milestone } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ConversationUsageSummary } from '@shared/stats';
import { TaskRoomChat } from '@renderer/features/agent-room/task-room-chat';
import { taskRoomQueryKey } from '@renderer/features/agent-room/team-room-queries';
import { openFeature } from '@renderer/features/features/feature-navigation';
import { useFeatures } from '@renderer/features/features/use-features';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { ConversationTree } from '@renderer/features/tasks/conversations/conversation-tree';
import { useArchivedConversations } from '@renderer/features/tasks/conversations/use-archived-conversations';
import {
  getTaskStore,
  taskAncestors,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
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
  const provisioned = useRequireProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const showNewConversationModal = useShowModal('newConversationModal');

  const sessions = Array.from(provisioned.conversations.conversations.values());
  const archivedSessions = useArchivedConversations(projectId, taskId);
  const sessionCount = sessions.length + archivedSessions.length;

  const { data: taskStats } = useTaskStats(projectId, taskId);
  const { data: features = [] } = useFeatures(projectId);
  const owningFeatures = features.filter((feature) => feature.taskIds.includes(taskId));
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

  // A team-room task: the overview tab IS the group chat (multi-agent paradigm).
  const { data: teamRoom } = useQuery({
    queryKey: taskRoomQueryKey(projectId, taskId),
    queryFn: () => rpc.teamRooms.getRoomForTask(projectId, taskId),
  });
  if (teamRoom) return <TaskRoomChat projectId={projectId} taskId={taskId} />;

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

        {owningFeatures.length > 0 ? (
          <section className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background-secondary px-3 py-2">
            <Milestone className="size-3.5 shrink-0 text-foreground-muted" />
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-foreground-passive">
              {t('featureDelivery.taskContext')}
            </span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {owningFeatures.map((feature) => (
                <button
                  key={feature.id}
                  type="button"
                  className="max-w-64 truncate rounded bg-background px-2 py-1 text-xs text-foreground ring-1 ring-inset ring-border transition-colors hover:bg-background-1"
                  onClick={() => openFeature(projectId, feature.id)}
                >
                  {feature.title}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {t('tasks.overview.sessions', { count: sessionCount })}
            </h2>
            <Button size="sm" variant="ghost" onClick={handleCreate}>
              <MessageSquarePlus className="size-4" />
              {t('tasks.tabs.newConversation')}
            </Button>
          </div>

          {sessionCount === 0 ? (
            <EmptyState label={t('tasks.overview.noSessions')} />
          ) : (
            <ConversationTree
              activeConversations={sessions}
              archivedConversations={archivedSessions}
              activeConversationId={tabManager.activeConversationId}
              usageByConversation={usageByConversation}
              onOpenActive={(conversationId) => tabManager.openConversation(conversationId)}
            />
          )}
        </section>

        <SubtaskList projectId={projectId} taskId={taskId} />
      </div>
    </div>
  );
});
