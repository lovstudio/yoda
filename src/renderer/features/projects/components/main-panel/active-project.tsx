import { observer } from 'mobx-react-lite';
import { useTranslation } from 'react-i18next';
import { OverviewPanel } from '@renderer/features/projects/components/overview-view/overview-panel';
import { PullRequestView } from '@renderer/features/projects/components/pr-view/pr-view';
import { SettingsPanel } from '@renderer/features/projects/components/settings-view/settings-panel';
import { TaskList } from '@renderer/features/projects/components/task-view/task-list';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';

export const ActiveProject = observer(function ActiveProject() {
  const { t } = useTranslation();
  const {
    params: { projectId },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));

  if (!store) return null;

  const activeView = store.view.activeView;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="border-b border-border px-4 py-2 shrink-0 flex justify-center">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[activeView]}
          className="rounded-lg overflow-hidden shadow-none h-7 border border-border"
          onValueChange={([value]) => {
            if (value) store.view.setProjectView(value as ProjectView);
          }}
        >
          <ToggleGroupItem value="overview" size="sm">
            {t('projects.overview')}
          </ToggleGroupItem>
          <ToggleGroupItem value="tasks" size="sm">
            {t('tasks.task')}
          </ToggleGroupItem>
          <ToggleGroupItem value="pull-request" size="sm">
            {t('pullRequests.title')}
          </ToggleGroupItem>
          <ToggleGroupItem value="settings" size="sm">
            {t('common.settings')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex-1 min-h-0">
        {activeView === 'overview' && <OverviewPanel />}
        {activeView === 'tasks' && <TaskList />}
        {activeView === 'pull-request' && <PullRequestView />}
        {activeView === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
});
