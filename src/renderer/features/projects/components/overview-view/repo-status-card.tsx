import { ExternalLink, GitBranch, Github } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { useIssues } from '@renderer/features/integrations/use-issues';
import { usePullRequests } from '@renderer/features/projects/components/pr-view/usePullRequests';
import {
  asMounted,
  getProjectStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import {
  FilePathActionsDropdown,
  type FilePathTarget,
} from '@renderer/lib/components/file-path-actions';
import { rpc } from '@renderer/lib/ipc';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';

const GITHUB_SUMMARY_LIMIT = 50;

export const RepoStatusCard = observer(function RepoStatusCard({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const project = asMounted(getProjectStore(projectId));
  const repo = getRepositoryStore(projectId);
  const repositoryUrl = repo?.repositoryUrl ?? null;
  const { authenticated, isInitialized } = useGithubContext();

  const { prs, loading: prsLoading } = usePullRequests(projectId, repositoryUrl ?? undefined, {
    filters: { status: 'open' },
    sort: 'newest',
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  const { issues, isLoading: issuesLoading } = useIssues('github', {
    projectId,
    repositoryUrl: repositoryUrl ?? undefined,
    initialLimit: GITHUB_SUMMARY_LIMIT,
    enabled: Boolean(repositoryUrl) && isInitialized && authenticated,
  });

  if (!project) return null;

  const branchLabel = repo?.defaultBranch
    ? repo.defaultBranch.type === 'remote'
      ? `${repo.defaultBranch.remote.name}/${repo.defaultBranch.branch}`
      : repo.defaultBranch.branch
    : '—';
  const currentBranch = repo?.currentBranch ?? '—';
  const remote = repo?.configuredRemote;
  const projectPath = project.data.path;
  const projectPathTarget: FilePathTarget = {
    absolutePath: projectPath,
    kind: 'directory',
    sshConnectionId: project.data.type === 'ssh' ? project.data.connectionId : null,
  };
  const githubSummary = !repositoryUrl
    ? null
    : !isInitialized || prsLoading || (authenticated && issuesLoading)
      ? t('projects.githubSummaryLoading')
      : !authenticated
        ? t('projects.githubSummaryAuthRequired')
        : t('projects.githubSummary', {
            pullRequests: prs.length,
            issues: issues.length,
          });

  return (
    <section className="rounded-lg border border-border bg-background-elevated p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">{t('common.repository')}</h2>
        {repositoryUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void rpc.app.openExternal(repositoryUrl)}
          >
            <Github className="size-3.5" />
            {t('projects.openOnGitHub')}
            <ExternalLink className="size-3" />
          </Button>
        )}
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
        <dt className="text-foreground-muted">{t('common.path')}</dt>
        <dd className="flex min-w-0 items-center gap-2 font-mono" title={projectPath}>
          <span className="min-w-0 flex-1 truncate">{projectPath}</span>
          <FilePathActionsDropdown target={projectPathTarget} className="ml-auto shrink-0" />
        </dd>
        <dt className="text-foreground-muted">{t('projects.currentBranch')}</dt>
        <dd className="font-mono inline-flex items-center gap-1">
          <GitBranch className="size-3" />
          {currentBranch}
        </dd>
        <dt className="text-foreground-muted">{t('projects.defaultBranch')}</dt>
        <dd className="font-mono">{branchLabel}</dd>
        {remote && (
          <>
            <dt className="text-foreground-muted">{t('projects.remote')}</dt>
            <dd className="font-mono truncate" title={remote.url || undefined}>
              {remote.name}
              {remote.url ? ` · ${remote.url}` : ''}
            </dd>
          </>
        )}
        {githubSummary && (
          <>
            <dt className="text-foreground-muted">GitHub</dt>
            <dd className="truncate">{githubSummary}</dd>
          </>
        )}
      </dl>
    </section>
  );
});
