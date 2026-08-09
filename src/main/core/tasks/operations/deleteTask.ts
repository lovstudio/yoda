import { and, eq } from 'drizzle-orm';
import { taskDeletedChannel } from '@shared/events/taskEvents';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { reclaimTaskRuntime } from '@main/core/tasks/task-runtime-reclamation';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

export async function deleteTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);
  if (!project) {
    log.error('deleteTask: project runtime unavailable; preserving task and session leaves', {
      projectId,
      taskId,
    });
    throw new Error('Project runtime is unavailable; task deletion aborted before cleanup.');
  }

  // This must run before deleting the task row: detached-session cleanup
  // derives tmux names from the task's conversation and terminal leaves.
  const runtimeReclamation = await reclaimTaskRuntime(projectId, taskId, project.ctx);
  if (!runtimeReclamation.confirmed) {
    log.error('deleteTask: runtime reclamation failed; preserving task and worktree', {
      projectId,
      taskId,
      failures: runtimeReclamation.failures,
    });
    const details = runtimeReclamation.failures
      .map((failure) => `${failure.stage}: ${failure.error}`)
      .join('; ');
    throw new Error(`Task runtime cleanup was not confirmed; deletion aborted. ${details}`);
  }

  // Reparent children to the grandparent (or top level) — deleting a parent
  // must not destroy or orphan its subtasks.
  await db
    .update(tasks)
    .set({ parentTaskId: task.parentTaskId ?? null })
    .where(eq(tasks.parentTaskId, taskId));
  await db.delete(tasks).where(eq(tasks.id, taskId));
  void viewStateService.del(`task:${taskId}`);
  taskEvents._emit('task:deleted', taskId, projectId);
  events.emit(taskDeletedChannel, {
    taskId,
    projectId,
    parentTaskId: task.parentTaskId ?? undefined,
  });
  telemetryService.capture('task_deleted', { project_id: projectId, task_id: taskId });

  if (task.taskBranch) {
    const siblings = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, task.projectId), eq(tasks.taskBranch, task.taskBranch)))
      .limit(1);

    if (siblings.length === 0) {
      await project.removeTaskWorktree(task.taskBranch).catch((e) => {
        log.warn('deleteTask: worktree removal failed', { taskId, error: String(e) });
      });
    }
  }
}
