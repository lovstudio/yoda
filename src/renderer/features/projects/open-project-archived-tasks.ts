import {
  asMounted,
  getProjectManagerStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';

/** Opens the project's dedicated task archive with the project mounted first. */
export async function openProjectArchivedTasks(
  projectId: string,
  navigate: NavigateFnTyped
): Promise<void> {
  await getProjectManagerStore().mountProject(projectId);
  asMounted(getProjectStore(projectId))?.view.taskView.setTab('archived');
  navigate('project', { projectId, view: 'tasks' });
}
