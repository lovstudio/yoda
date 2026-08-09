import { taskRestoredChannel } from '@shared/events/taskEvents';
import { events } from '@main/lib/events';

/** Broadcasts only same-project restored ids, even if relational data is damaged. */
export function emitTaskRestoredEvents(
  restoredTasks: ReadonlyArray<{ id: string; projectId: string }>
): void {
  const taskIdsByProject = new Map<string, string[]>();
  for (const task of restoredTasks) {
    const taskIds = taskIdsByProject.get(task.projectId) ?? [];
    taskIds.push(task.id);
    taskIdsByProject.set(task.projectId, taskIds);
  }
  for (const [projectId, restoredTaskIds] of taskIdsByProject) {
    events.emit(taskRestoredChannel, { projectId, restoredTaskIds });
  }
}
