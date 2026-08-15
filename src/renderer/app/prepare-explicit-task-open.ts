import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';

/**
 * Mounts and point-loads a task before an explicit open.
 *
 * Opening never changes archive state. Archiving is organizational and an
 * archived task opens and runs like any other, so restoring is left to the
 * explicit Restore action instead of happening as a side effect of a click.
 */
export async function prepareExplicitTaskOpen(projectId: string, taskId: string): Promise<void> {
  const projectManager = getProjectManagerStore();
  const projectLoaded = await projectManager.ensureProjectLoaded(projectId);
  if (!projectLoaded) throw new Error(`Project ${projectId} could not be loaded`);
  await projectManager.mountProject(projectId);

  const taskManager = getTaskManagerStore(projectId);
  if (!taskManager) throw new Error(`Project ${projectId} could not be mounted`);
  const taskLoaded = await taskManager.ensureTaskLoaded(taskId);
  if (!taskLoaded) throw new Error(`Task ${taskId} could not be loaded`);

  const task = taskManager.tasks.get(taskId);
  if (!task || task.state === 'unregistered') throw new Error(`Task ${taskId} could not be loaded`);
}
