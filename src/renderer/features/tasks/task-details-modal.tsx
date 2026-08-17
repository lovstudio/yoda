import { ArrowUpRight, ChevronRight, GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { ConversationUsageSummary } from '@shared/stats';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { ConversationTree } from '@renderer/features/tasks/conversations/conversation-tree';
import { useArchivedConversations } from '@renderer/features/tasks/conversations/use-archived-conversations';
import { openTaskWhenReady } from '@renderer/features/tasks/open-task-when-ready';
import {
  asProvisioned,
  getTaskStore,
  taskAncestors,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { TaskStatsStrip } from './components/task-stats-strip';
import { useTaskStats } from './hooks/useTaskStats';
import { SubtaskList } from './view/subtask-list';

export type TaskDetailsModalArgs = {
  projectId: string;
  taskId: string;
};

type Props = BaseModalProps<void> & TaskDetailsModalArgs;

/**
 * A task's own secondary page: identity, code/token totals, its session tree
 * and its sub-tasks. A task IS its session, so none of this sits between the
 * user and the working surface — it opens on demand from the titlebar or a
 * task menu, over whatever the user was doing.
 *
 * Hosted outside the task view, so every store is read through selectors. Live
 * session stores only exist for a provisioned task; an idle one still shows its
 * identity, stats, archived sessions and sub-tasks.
 */
export const TaskDetailsModal = observer(function TaskDetailsModal({
  projectId,
  taskId,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { navigate } = useNavigate();

  const taskStore = getTaskStore(projectId, taskId);
  const provisioned = asProvisioned(taskStore);
  const sessions = Array.from(provisioned?.conversations.conversations.values() ?? []);
  const archivedSessions = useArchivedConversations(projectId, taskId);
  const sessionCount = sessions.length + archivedSessions.length;

  const { data: taskStats } = useTaskStats(projectId, taskId);
  const usageByConversation = new Map<string, ConversationUsageSummary>(
    (taskStats?.conversations ?? []).map((usage) => [usage.conversationId, usage])
  );

  const projectName = projectDisplayName(getProjectStore(projectId)) ?? projectId;
  const taskName = taskDisplayName(taskStore) ?? taskId;
  // An idle task has no live workspace, but its persisted row still knows the
  // branch archiving/provisioning will restore it onto.
  const branchName =
    provisioned?.workspace.git.branchName ??
    provisioned?.taskBranch ??
    (taskStore && 'taskBranch' in taskStore.data ? taskStore.data.taskBranch : undefined);
  // Parent chain root-first for the breadcrumb; long chains collapse the middle.
  const ancestors = taskAncestors(projectId, taskId).reverse();
  const breadcrumbAncestors =
    ancestors.length > 3 ? [ancestors[0], null, ancestors[ancestors.length - 1]] : ancestors;

  const openSession = (conversationId: string) => {
    void openTaskWhenReady(projectId, taskId, navigate, { kind: 'conversation', conversationId });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="min-w-0 truncate" title={taskName}>
          {taskName}
        </DialogTitle>
        {/* Ancestry only — the title above already names this task. */}
        <div className="flex min-w-0 items-center gap-1 text-xs text-foreground-passive">
          <button
            type="button"
            className="-mx-1 inline-flex min-w-0 items-center rounded px-1 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => {
              navigate('project', { projectId });
              onClose();
            }}
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
                  onClick={() => {
                    void openTaskWhenReady(projectId, ancestor.data.id, navigate);
                    onClose();
                  }}
                  title={ancestor.data.name}
                >
                  <span className="min-w-0 truncate">{ancestor.data.name}</span>
                </button>
              </span>
            )
          )}
        </div>
      </DialogHeader>
      <DialogContentArea className="flex flex-col gap-5">
        {(branchName || taskStats) && (
          <div className="flex flex-col gap-2">
            {branchName && (
              <div className="flex items-center gap-1.5 text-xs text-foreground-passive">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate font-mono" title={branchName}>
                  {branchName}
                </span>
              </div>
            )}
            {taskStats && <TaskStatsStrip stats={taskStats} />}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">
              {t('tasks.details.sessions', { count: sessionCount })}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void openTaskWhenReady(projectId, taskId, navigate);
                onClose();
              }}
            >
              <ArrowUpRight className="size-4" />
              {t('tasks.details.openTask')}
            </Button>
          </div>

          {sessionCount === 0 ? (
            <EmptyState label={t('tasks.details.noSessions')} />
          ) : (
            <ConversationTree
              owner={{ projectId, taskId, provisioned }}
              activeConversations={sessions}
              archivedConversations={archivedSessions}
              activeConversationId={provisioned?.taskView.tabManager.activeConversationId}
              usageByConversation={usageByConversation}
              onOpenActive={openSession}
            />
          )}
        </section>

        <SubtaskList projectId={projectId} taskId={taskId} onNavigate={onClose} />
      </DialogContentArea>
    </>
  );
});
