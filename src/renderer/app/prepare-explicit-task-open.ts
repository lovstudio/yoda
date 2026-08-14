import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';

type PrepareExplicitTaskOpenOptions = {
  /**
   * Restoring is a lifecycle mutation, so read-only task opens must opt out.
   * Explicit Restore actions retain the existing default behavior.
   */
  restoreArchived?: boolean;
};

/** Mounts and point-loads a task before an explicit open. */
export async function prepareExplicitTaskOpen(
  projectId: string,
  taskId: string,
  options: PrepareExplicitTaskOpenOptions = {}
): Promise<void> {
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
  if (options.restoreArchived !== false && 'archivedAt' in task.data && task.data.archivedAt) {
    await taskManager.restoreTask(taskId);
  }
}
