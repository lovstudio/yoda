import { observer } from 'mobx-react-lite';
import { DocsPanel } from '@renderer/features/projects/components/docs-view/docs-panel';
import { HarnessPanel } from '@renderer/features/projects/components/harness-view/harness-panel';
import { OverviewPanel } from '@renderer/features/projects/components/overview-view/overview-panel';
import { ProjectSessionsPanel } from '@renderer/features/projects/components/sessions-view/project-sessions-panel';
import { SettingsPanel } from '@renderer/features/projects/components/settings-view/settings-panel';
import { TaskList } from '@renderer/features/projects/components/task-view/task-list';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { useParams } from '@renderer/lib/layout/navigation-provider';

/**
 * Project pages are top-level tabs (the app tab strip in the titlebar) —
 * the route's `view` param selects which page renders here.
 */
export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId, view },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));

  if (!store) return null;

  const activeView = (view ?? 'overview') as ProjectView;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0">
        {activeView === 'overview' && <OverviewPanel />}
        {activeView === 'tasks' && <TaskList />}
        {activeView === 'sessions' && <ProjectSessionsPanel />}
        {activeView === 'harness' && <HarnessPanel />}
        {activeView === 'docs' && <DocsPanel projectId={projectId} />}
        {activeView === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
});
