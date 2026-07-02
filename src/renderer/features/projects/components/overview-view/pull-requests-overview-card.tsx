import { ArrowRight, ExternalLink, GitPullRequest, Loader2, ScanSearch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPrNumber, isForkPr, type PullRequest } from '@shared/pull-requests';
import { ensureUniqueTaskDisplayName, normalizeTaskDisplayName } from '@shared/task-name';
import type { CreateTaskParams } from '@shared/tasks';
import { usePullRequests } from '@renderer/features/projects/components/pr-view/usePullRequests';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { resolvePullRequestTaskStrategy } from '@renderer/features/tasks/create-task-modal/create-task-strategy';
import { isRegistered } from '@renderer/features/tasks/stores/task';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const RECENT_LIMIT = 3;

function reviewTaskDisplayName(
  pr: PullRequest,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const title = pr.title.trim() || pr.headRefName;
  const name = pr.identifier
    ? t('pullRequests.reviewTaskNameWithIdentifier', { identifier: pr.identifier, title })
    : t('pullRequests.reviewTaskName', { title });
  const fallback = pr.identifier ? `Review ${pr.identifier}` : `Review ${pr.headRefName}`;
  return normalizeTaskDisplayName(name) || normalizeTaskDisplayName(fallback);
}

function buildPullRequestReviewTaskParams({
  id,
  projectId,
  pr,
  name,
}: {
  id: string;
  projectId: string;
  pr: PullRequest;
  name: string;
}): CreateTaskParams {
  const reviewBranch = pr.headRefName;
  return {
    id,
    projectId,
    name,
    sourceBranch: { type: 'local', branch: reviewBranch },
    initialStatus: pr.status === 'open' && !pr.isDraft ? 'review' : undefined,
    strategy: resolvePullRequestTaskStrategy({
      checkoutMode: 'checkout',
      prNumber: getPrNumber(pr) ?? 0,
      headBranch: reviewBranch,
      headRepositoryUrl: pr.headRepositoryUrl,
      isFork: isForkPr(pr),
      taskBranch: name,
      pushBranch: false,
    }),
  };
}

function PullRequestOverviewRow({
  pr,
  projectId,
  alreadyInTask,
  disabled,
  onViewAll,
}: {
  pr: PullRequest;
  projectId: string;
  alreadyInTask: boolean;
  disabled: boolean;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const showCreateTaskModal = useShowModal('taskModal');
  const prNumber = getPrNumber(pr);

  return (
    <li>
      <div className="group/pr rounded-md px-2 py-2 transition-colors hover:bg-background-hover">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onViewAll}>
            <span className="flex min-w-0 items-center gap-2 text-xs">
              <StatusIcon status={pr.status} className="size-3.5" />
              {prNumber !== null && <PrNumberBadge number={prNumber} />}
              <span className="truncate font-medium text-foreground">{pr.title}</span>
            </span>
            <span className="mt-1 block text-xs text-foreground-muted">
              <RelativeTime value={pr.updatedAt} compact />
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover/pr:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled || alreadyInTask}
                    aria-label={
                      alreadyInTask
                        ? t('pullRequests.alreadyInTask')
                        : t('pullRequests.reviewInTask')
                    }
                    onClick={() =>
                      showCreateTaskModal({
                        projectId,
                        strategy: 'from-pull-request',
                        initialPR: pr,
                      })
                    }
                  >
                    <ScanSearch className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent>
                {alreadyInTask ? t('pullRequests.alreadyInTask') : t('pullRequests.reviewInTask')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('pullRequests.openOnGitHub')}
                    onClick={() => void rpc.app.openExternal(pr.url)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                }
              />
              <TooltipContent>{t('pullRequests.openOnGitHub')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <PrMergeLine pr={pr} className="mt-1 overflow-hidden" />
      </div>
    </li>
  );
}

export const PullRequestsOverviewCard = observer(function PullRequestsOverviewCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const repo = getRepositoryStore(projectId);
  const taskManager = getTaskManagerStore(projectId);
  const repositoryUrl = repo?.repositoryUrl ?? null;
  const { authenticated, isInitialized } = useGithubContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [isCreatingReviewTasks, setIsCreatingReviewTasks] = useState(false);

  const { prs, loading } = usePullRequests(projectId, repositoryUrl ?? undefined, {
    filters: { status: 'open' },
    sort: 'newest',
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  const goToPrs = () => {
    appState.appTabs.openTab('project', { projectId, view: 'pullRequests' });
  };

  const existingTaskPrUrls = new Set<string>();
  if (taskManager) {
    for (const task of taskManager.tasks.values()) {
      if (!isRegistered(task) || task.data.archivedAt) continue;
      for (const taskPr of task.data.prs) {
        existingTaskPrUrls.add(taskPr.url);
      }
    }
  }

  const recent = prs.slice(0, RECENT_LIMIT);
  const reviewablePrs = prs.filter((pr) => !existingTaskPrUrls.has(pr.url));

  const createReviewTasks = async (targetPrs: PullRequest[]) => {
    const manager = getTaskManagerStore(projectId);
    if (!manager) {
      toast.error(t('projects.projectNotReady'));
      return;
    }

    setIsCreatingReviewTasks(true);
    const existingNames = new Set(
      Array.from(manager.tasks.values(), (task) => task.data.name).filter(Boolean)
    );
    let created = 0;
    const failures: string[] = [];

    for (const pr of targetPrs) {
      const id = crypto.randomUUID();
      const name = ensureUniqueTaskDisplayName(reviewTaskDisplayName(pr, t), existingNames);
      existingNames.add(name);
      const params = buildPullRequestReviewTaskParams({ id, projectId, pr, name });

      try {
        await manager.createTask(params);
        created += 1;
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    setIsCreatingReviewTasks(false);

    if (created > 0) {
      toast.success(t('pullRequests.reviewTasksCreated', { count: created }));
      appState.appTabs.openTab('project', { projectId, view: 'tasks' });
    }

    if (failures.length > 0) {
      toast.error(t('pullRequests.reviewTasksCreateFailed', { count: failures.length }), {
        description: failures[0],
      });
    }
  };

  const confirmReviewOpenPrs = () => {
    if (reviewablePrs.length === 0) {
      toast(t('pullRequests.noNewPrsToReview'));
      return;
    }

    showConfirm({
      title: t('pullRequests.reviewOpenPrsTitle', { count: reviewablePrs.length }),
      description: t('pullRequests.reviewOpenPrsDescription', { count: reviewablePrs.length }),
      confirmLabel: t('pullRequests.reviewOpenPrsConfirm'),
      variant: 'default',
      onSuccess: () => {
        void createReviewTasks(reviewablePrs);
      },
    });
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground inline-flex items-center gap-2">
            <GitPullRequest className="size-3.5" />
            {t('pullRequests.title')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('pullRequests.openCount', { count: prs.length })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={confirmReviewOpenPrs}
            disabled={
              !repositoryUrl ||
              !authenticated ||
              reviewablePrs.length === 0 ||
              isCreatingReviewTasks
            }
          >
            {isCreatingReviewTasks ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ScanSearch className="size-3.5" />
            )}
            {t('pullRequests.reviewOpenPrsCount', { count: reviewablePrs.length })}
          </Button>
          <Button variant="ghost" size="sm" onClick={goToPrs} disabled={!repositoryUrl}>
            {t('projects.viewAll')}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>
      {!repositoryUrl ? (
        <p className="text-xs text-foreground-muted">
          {t('pullRequests.noGitHubRemoteConfigured')}
        </p>
      ) : isInitialized && !authenticated ? (
        <p className="text-xs text-foreground-muted">{t('pullRequests.githubAuthRequired')}</p>
      ) : loading && prs.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
      ) : recent.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('pullRequests.noOpenPullRequests')}</p>
      ) : (
        <ul className="space-y-1">
          {recent.map((pr) => (
            <PullRequestOverviewRow
              key={pr.url}
              pr={pr}
              projectId={projectId}
              alreadyInTask={existingTaskPrUrls.has(pr.url)}
              disabled={isCreatingReviewTasks}
              onViewAll={goToPrs}
            />
          ))}
        </ul>
      )}
    </section>
  );
});
