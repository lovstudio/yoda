import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import {
  getProjectSettingsStore,
  getRepositoryStore,
} from '@renderer/features/projects/stores/project-selectors';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { PullRequestsOverviewCard } from './pull-requests-overview-card';
import { QuickActionsCard } from './quick-actions-card';
import { RepoStatusCard } from './repo-status-card';
import { TasksOverviewCard } from './tasks-overview-card';
import { TokenUsageCard } from './token-usage-card';

export const OverviewPanel = observer(function OverviewPanel() {
  const {
    params: { projectId },
  } = useParams('project');

  useEffect(() => {
    const repo = getRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
    void getProjectSettingsStore(projectId)?.pageData.load();
  }, [projectId]);

  return (
    <div className="overflow-y-auto h-full">
      <div className="max-w-3xl mx-auto w-full px-6 py-6 flex flex-col gap-4">
        <QuickActionsCard projectId={projectId} />
        <RepoStatusCard projectId={projectId} />
        <PullRequestsOverviewCard projectId={projectId} />
        <TokenUsageCard projectId={projectId} />
        <TasksOverviewCard projectId={projectId} />
      </div>
    </div>
  );
});
