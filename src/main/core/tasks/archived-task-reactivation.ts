import { eq } from 'drizzle-orm';
import {
  agentSessionStatusChangedChannel,
  isAgentSessionRunningStatus,
} from '@shared/events/agentEvents';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { restoreTaskWithoutDescendants } from './operations/restoreTask';

/**
 * Opening an archived task is read-only — that stays true. Sending it new work
 * is not: the moment its agent starts a turn the task holds live work, and an
 * archived row with a running agent is a lie in every surface that filters on
 * `archivedAt` (sidebar, kanban, counts, mobile). So reactivate on the agent's
 * own run state rather than on any single input path: the composer, a terminal
 * keystroke into the CLI TUI, mobile, and automation all converge here.
 */
class ArchivedTaskReactivationService {
  private offStatusChanged: (() => void) | null = null;
  private inFlight = new Set<string>();

  initialize(): void {
    if (this.offStatusChanged) return;
    this.offStatusChanged = events.on(agentSessionStatusChangedChannel, (event) => {
      if (!isAgentSessionRunningStatus(event.status)) return;
      void this.reactivate(event.taskId);
    });
  }

  dispose(): void {
    this.offStatusChanged?.();
    this.offStatusChanged = null;
    this.inFlight.clear();
  }

  private async reactivate(taskId: string): Promise<void> {
    if (this.inFlight.has(taskId)) return;
    this.inFlight.add(taskId);
    try {
      const [row] = await db
        .select({ archivedAt: tasks.archivedAt })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);
      if (!row?.archivedAt) return;

      log.info('archived task reactivated by agent activity', { taskId });
      await restoreTaskWithoutDescendants(taskId);
    } catch (error) {
      log.warn('archived task reactivation failed', { taskId, error: String(error) });
    } finally {
      this.inFlight.delete(taskId);
    }
  }
}

export const archivedTaskReactivationService = new ArchivedTaskReactivationService();
