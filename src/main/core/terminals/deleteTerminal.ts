import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveTask, withTimeout } from '../projects/utils';

export const TERMINAL_DELETE_KILL_TIMEOUT_MS = 2_000;

export async function deleteTerminal({
  projectId,
  taskId,
  terminalId,
}: {
  projectId: string;
  taskId: string;
  terminalId: string;
}) {
  await db
    .delete(terminals)
    .where(
      and(
        eq(terminals.id, terminalId),
        eq(terminals.projectId, projectId),
        eq(terminals.taskId, taskId)
      )
    );

  const task = resolveTask(projectId, taskId);
  if (task) {
    try {
      await withTimeout(task.terminals.killTerminal(terminalId), TERMINAL_DELETE_KILL_TIMEOUT_MS);
    } catch (error) {
      // The durable delete already succeeded. Providers invalidate their local
      // registration before remote/tmux cleanup, so surfacing this as a failed
      // delete would make the renderer resurrect a row that no longer exists.
      log.warn('deleteTerminal: terminal cleanup failed after durable deletion', {
        projectId,
        taskId,
        terminalId,
        error: String(error),
      });
    }
  }
  telemetryService.capture('terminal_deleted', {
    terminal_id: terminalId,
    project_id: projectId,
    task_id: taskId,
  });
}
