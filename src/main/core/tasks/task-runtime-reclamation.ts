import type { IExecutionContext } from '@main/core/execution-context/types';
import { cleanupDetachedSessions, taskManager } from '@main/core/tasks/task-manager';

export type TaskRuntimeReclamationFailure = {
  stage: 'teardown' | 'detached-sessions';
  error: string;
};

export type TaskRuntimeReclamationResult = {
  confirmed: boolean;
  failures: TaskRuntimeReclamationFailure[];
};

/**
 * Stops the in-memory task runtime first, then sweeps every persisted session
 * leaf for detached tmux sessions. Callers must invoke this while task leaf
 * rows still exist; otherwise the fallback cannot reconstruct session names.
 */
export async function reclaimTaskRuntime(
  projectId: string,
  taskId: string,
  ctx: IExecutionContext,
  options: { liveTmuxSessionNames?: Set<string> } = {}
): Promise<TaskRuntimeReclamationResult> {
  const failures: TaskRuntimeReclamationFailure[] = [];

  try {
    const teardown = await taskManager.teardownTask(taskId, 'terminate');
    if (!teardown.success) {
      failures.push({ stage: 'teardown', error: teardown.error.message });
    }
  } catch (error) {
    failures.push({ stage: 'teardown', error: String(error) });
  }

  try {
    await cleanupDetachedSessions(projectId, taskId, ctx, options);
  } catch (error) {
    failures.push({ stage: 'detached-sessions', error: String(error) });
  }

  return { confirmed: failures.length === 0, failures };
}
