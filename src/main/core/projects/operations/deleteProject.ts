import { eq } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { listTmuxSessionMarkersStrict } from '@main/core/pty/tmux-session-name';
import { prSyncEngine } from '@main/core/pull-requests/pr-sync-engine';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { reclaimTaskRuntime } from '@main/core/tasks/task-runtime-reclamation';
import { workspaceTerminalService } from '@main/core/terminals/workspace-terminal-service';
import { viewStateService } from '@main/core/view-state/view-state-service';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';

const PROJECT_TASK_CLEANUP_CONCURRENCY = 4;

async function cleanUpProjectTasks(
  projectId: string,
  project: NonNullable<ReturnType<typeof projectManager.getProject>>,
  liveTmuxSessionNames: Set<string>
): Promise<void> {
  const projectTasks = await getTasks(projectId);
  let nextIndex = 0;
  const errors: string[] = [];
  const workerCount = Math.min(PROJECT_TASK_CLEANUP_CONCURRENCY, projectTasks.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < projectTasks.length) {
        const task = projectTasks[nextIndex++];
        try {
          const result = await reclaimTaskRuntime(projectId, task.id, project.ctx, {
            liveTmuxSessionNames,
          });
          if (!result.confirmed) {
            throw new Error(
              result.failures.map((failure) => `${failure.stage}: ${failure.error}`).join('; ')
            );
          }
          await viewStateService.del(`task:${task.id}`);
        } catch (error) {
          errors.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })
  );
  if (errors.length > 0) {
    throw new Error(`Failed to clean up ${errors.length} project task(s): ${errors.join('; ')}`);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const project = projectManager.getProject(id);
  if (!project) {
    throw new Error('Project runtime is unavailable; project deletion aborted before cleanup.');
  }

  const liveTmuxSessionNames = new Set(
    (await listTmuxSessionMarkersStrict(project.ctx)).map((marker) => marker.sessionName)
  );
  await cleanUpProjectTasks(id, project, liveTmuxSessionNames);
  await workspaceTerminalService.terminateProject(id);
  await workspaceRegistry.releaseAllForProject(id, 'terminate');

  const closeResult = await projectManager.closeProject(id, { mode: 'terminate' });
  if (!closeResult.success) {
    throw new Error(`Failed to close project ${id}: ${closeResult.error.message}`);
  }

  await prSyncEngine.deleteProjectData(id);
  await viewStateService.del(`project:${id}`);

  await db.delete(projects).where(eq(projects.id, id));
  projectEvents._emit('project:deleted', id);
  telemetryService.capture('project_deleted', { project_id: id });
}
