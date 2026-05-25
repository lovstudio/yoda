import { ArrowRight, GitPullRequest } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { usePullRequests } from '@renderer/features/projects/components/pr-view/usePullRequests';
import {
  asMounted,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';

const RECENT_LIMIT = 3;

export const PullRequestsOverviewCard = observer(function PullRequestsOverviewCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const project = asMounted(getProjectStore(projectId));
  const repo = getRepositoryStore(projectId);
  const repositoryUrl = repo?.repositoryUrl ?? null;

  const { prs, loading } = usePullRequests(projectId, repositoryUrl ?? undefined, {
    filters: { status: 'open' },
    sort: 'newest',
    enabled: Boolean(repositoryUrl),
  });

  const goToPrs = () => {
    if (project) project.view.setProjectView('pull-request' as ProjectView);
  };

  const recent = prs.slice(0, RECENT_LIMIT);

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground inline-flex items-center gap-2">
            <GitPullRequest className="size-3.5" />
            {t('pullRequests.title')}
          </h2>
          <span className="text-xs text-foreground-muted">
            {t('pullRequests.openCount', { count: prs.length })}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={goToPrs} disabled={!repositoryUrl}>
          {t('projects.viewAll')}
          <ArrowRight className="size-3.5" />
        </Button>
      </header>
      {!repositoryUrl ? (
        <p className="text-xs text-foreground-muted">
          {t('pullRequests.noGitHubRemoteConfigured')}
        </p>
      ) : loading && prs.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('common.loading')}</p>
      ) : recent.length === 0 ? (
        <p className="text-xs text-foreground-muted">{t('pullRequests.noOpenPullRequests')}</p>
      ) : (
        <ul className="space-y-1">
          {recent.map((pr) => (
            <li key={pr.url}>
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-background-hover transition-colors"
                onClick={() => void rpc.app.openExternal(pr.url)}
              >
                <span className="truncate font-medium text-foreground">
                  {pr.identifier ? `${pr.identifier} ` : ''}
                  {pr.title}
                </span>
                <span className="text-foreground-muted shrink-0">
                  <RelativeTime value={pr.updatedAt} compact />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
