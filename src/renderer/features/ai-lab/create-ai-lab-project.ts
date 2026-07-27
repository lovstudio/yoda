import type { MountedProject } from '@renderer/features/projects/stores/project';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';

/**
 * Creates the dedicated local Git project owned by one AI Lab App. App build
 * tasks and later refinements must use this project instead of whichever
 * product project happened to be selected in Home.
 */
export async function createAiLabProject(name: string): Promise<MountedProject> {
  const projectManager = getProjectManagerStore();
  const prepared = await rpc.projects.prepareQuickProject({ name });
  const projectId = await projectManager.createProject(
    { type: 'local' },
    {
      mode: 'pick',
      name: prepared.name,
      path: prepared.path,
      initGitRepository: true,
    }
  );
  if (!projectId) throw new Error('The App project could not be created.');

  await projectManager.mountProject(projectId);
  const project = asMounted(projectManager.projects.get(projectId));
  if (!project || project.data.type !== 'local') {
    throw new Error('The App project could not be opened.');
  }
  await rpc.aiLab.scaffoldAppProject({ projectId, name: prepared.name });
  return project;
}
