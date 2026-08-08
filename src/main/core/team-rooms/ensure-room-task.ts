import type { OpenProjectError } from '@shared/projects';
import { openProject } from '@main/core/projects/operations/openProject';
import { resolveTask } from '@main/core/projects/utils';
import { provisionTask } from '@main/core/tasks/provisionTask';

function describeOpenProjectError(error: OpenProjectError): string {
  if (error.type === 'path-not-found') return `project path is missing: ${error.path}`;
  if (error.type === 'ssh-disconnected') {
    return `SSH connection is offline: ${error.connectionId}`;
  }
  return error.message;
}

/**
 * Agent Rooms keep running independently of the renderer. After an app restart,
 * a room can receive a team-at callback before its project has been mounted by
 * any window. Restore the project/task providers here so first-contact delivery
 * can create or resume the target member without depending on UI navigation.
 */
export async function ensureRoomTaskAvailable(projectId: string, taskId: string): Promise<void> {
  if (resolveTask(projectId, taskId)) return;

  const opened = await openProject(projectId);
  if (!opened.success) {
    throw new Error(
      `Agent Room project could not be opened: ${describeOpenProjectError(opened.error)}`
    );
  }

  await provisionTask(taskId);
  if (!resolveTask(projectId, taskId)) {
    throw new Error(`Agent Room task did not become available after provisioning: ${taskId}`);
  }
}
