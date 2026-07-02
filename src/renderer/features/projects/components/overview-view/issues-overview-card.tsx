import {
  ArrowRight,
  CircleDot,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  ScanSearch,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import type { Issue } from '@shared/tasks';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { CreateIssueButton } from '@renderer/features/projects/components/issues-view/create-issue-button';
import {
  getLinkedTaskStores,
  IssueLinkedTasks,
  IssueTaskLinkPopover,
} from '@renderer/features/projects/components/issues-view/issue-task-links';
import { useIssueTaskCreation } from '@renderer/features/projects/components/issues-view/use-issue-task-creation';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { IssueIdentifier } from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const ISSUE_FETCH_LIMIT = 50;
const RECENT_LIMIT = 3;

function IssueOverviewActions({
  issue,
  projectId,
  onViewAll,
}: {
  issue: Issue;
  projectId: string;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const showCreateTaskModal = useShowModal('taskModal');
  const alreadyInTask = getLinkedTaskStores(projectId, issue).length > 0;

  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover/issue:opacity-100">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={alreadyInTask}
              aria-label={alreadyInTask ? t('issues.alreadyInTask') : t('issues.createTask')}
              onClick={() =>
                showCreateTaskModal({ projectId, strategy: 'from-issue', initialIssue: issue })
              }
            >
              <ScanSearch className="size-3.5" />
            </Button>
          }
        />
        <TooltipContent>
          {alreadyInTask ? t('issues.alreadyInTask') : t('issues.createTask')}
        </TooltipContent>
      </Tooltip>
      <IssueTaskLinkPopover issue={issue} projectId={projectId} iconOnly />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label={t('common.more')}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => void rpc.app.openExternal(issue.url)}>
            <ExternalLink className="size-3.5" />
            {t('issues.openOnGitHub')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onViewAll}>
            <ArrowRight className="size-3.5" />
            {t('projects.viewAll')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const IssuesOverviewCard = observer(function IssuesOverviewCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const repo = getRepositoryStore(projectId);
  const repositoryUrl = repo?.repositoryUrl ?? null;
  const { authenticated, isInitialized } = useGithubContext();

  const { issues, isLoading, syncCreatedIssue } = useIssues('github', {
    projectId,
    repositoryUrl: repositoryUrl ?? undefined,
    initialLimit: ISSUE_FETCH_LIMIT,
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  const recentIssues = issues.slice(0, RECENT_LIMIT);
  const { createIssueTasks, isCreatingIssueTasks, taskableIssues } = useIssueTaskCreation(
    projectId,
    issues
  );
  const showConfirm = useShowModal('confirmActionModal');

  const goToIssues = () => {
    appState.appTabs.openTab('project', { projectId, view: 'issues' });
  };

  const confirmCreateIssueTasks = () => {
    if (taskableIssues.length === 0) return;
    showConfirm({
      title: t('issues.createTasksTitle', { count: taskableIssues.length }),
      description: t('issues.createTasksDescription', { count: taskableIssues.length }),
      confirmLabel: t('issues.createTasksConfirm'),
      variant: 'default',
      onSuccess: () => {
        void createIssueTasks(taskableIssues);
      },
    });
  };

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <CircleDot className="size-3.5" />
            {t('issues.issues')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('issues.openCount', { count: issues.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={confirmCreateIssueTasks}
            disabled={
              !repositoryUrl ||
              !authenticated ||
              taskableIssues.length === 0 ||
              isCreatingIssueTasks
            }
          >
            {isCreatingIssueTasks ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ScanSearch className="size-3.5" />
            )}
            {taskableIssues.length > 0
              ? t('issues.createTasksCount', { count: taskableIssues.length })
              : t('issues.allIssuesInTasks')}
          </Button>
          <CreateIssueButton
            repositoryUrl={repositoryUrl}
            projectId={projectId}
            disabled={!isInitialized || !authenticated}
            iconOnly
            onCreated={syncCreatedIssue}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goToIssues}
                  disabled={!repositoryUrl || !authenticated}
                  aria-label={t('projects.viewAll')}
                >
                  <ArrowRight className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t('projects.viewAll')}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      {!repositoryUrl ? (
        <p className="text-xs text-foreground-muted">{t('issues.noGitHubRemoteConfigured')}</p>
      ) : isInitialized && !authenticated ? (
        <p className="text-xs text-foreground-muted">{t('issues.githubAuthRequired')}</p>
      ) : isLoading && issues.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
      ) : recentIssues.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('issues.noOpenIssues')}</p>
      ) : (
        <ul className="space-y-1">
          {recentIssues.map((issue) => (
            <li key={issue.url || issue.identifier}>
              <div className="group/issue rounded-md px-2 py-1.5 transition-colors hover:bg-background-hover">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left text-xs"
                    onClick={() => void rpc.app.openExternal(issue.url)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <IssueIdentifier identifier={issue.identifier} />
                      <span className="truncate font-medium text-foreground">{issue.title}</span>
                    </span>
                    {issue.updatedAt ? (
                      <span className="mt-1 block text-foreground-muted">
                        <RelativeTime value={issue.updatedAt} compact />
                      </span>
                    ) : null}
                  </button>
                  <IssueOverviewActions
                    issue={issue}
                    projectId={projectId}
                    onViewAll={goToIssues}
                  />
                </div>
                <div className="mt-1 flex min-w-0 items-center">
                  <IssueLinkedTasks
                    issue={issue}
                    projectId={projectId}
                    maxVisible={2}
                    className="min-w-0 flex-1"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
