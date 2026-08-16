import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { taskStatusUpdatedChannel } from '@shared/events/taskEvents';
import type { RestoreTaskResult } from '@shared/tasks';
import { unarchiveConversation } from '@main/core/conversations/unarchiveConversation';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { conversations, tasks } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { emitTaskRestoredEvents } from '../task-restored-events';
import { getDescendantTaskIds } from './task-hierarchy';

export async function restoreTask(id: string): Promise<RestoreTaskResult> {
  // Cascade: restore the task plus all archived descendants. Ancestors are
  // left untouched — the sidebar promotes orphaned subtrees at display time.
  const descendantIds = await getDescendantTaskIds(id);
  const restoredTasks: Array<{ id: string; projectId: string }> = [];

  await restoreSingleTask(id, restoredTasks);

  if (descendantIds.length > 0) {
    const archivedDescendants = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(inArray(tasks.id, descendantIds), isNotNull(tasks.archivedAt)));
    const archivedIds = new Set(archivedDescendants.map((d) => d.id));
    // descendantIds is parents-before-children — restore top-down.
    for (const descendantId of descendantIds) {
      if (!archivedIds.has(descendantId)) continue;
      await restoreSingleTask(descendantId, restoredTasks);
    }
  }

  const restoredTaskIds = restoredTasks.map((task) => task.id);
  emitTaskRestoredEvents(restoredTasks);
  return { restoredTaskIds };
}

/**
 * Restore exactly one task, leaving its archived descendants archived.
 *
 * Used when a task comes back to life on its own — an archived session that
 * starts a new turn. Only the task that is actually running should leave the
 * archive; cascading to its subtree there would unarchive work nobody touched.
 */
export async function restoreTaskWithoutDescendants(id: string): Promise<boolean> {
  const restoredTasks: Array<{ id: string; projectId: string }> = [];
  await restoreSingleTask(id, restoredTasks);
  emitTaskRestoredEvents(restoredTasks);
  return restoredTasks.length > 0;
}

async function restoreSingleTask(
  id: string,
  restoredTasks: Array<{ id: string; projectId: string }>
): Promise<void> {
  const [updatedRow] = await db
    .update(tasks)
    .set({
      archivedAt: null,
      archiveRequestedAt: null,
      status: 'in_progress',
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, id))
    .returning();

  if (!updatedRow) return;

  restoredTasks.push({ id: updatedRow.id, projectId: updatedRow.projectId });
  taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
  // `taskRestoredChannel` only clears the archive flags in renderer stores; the
  // lifecycle status is carried by its own channel, so a restored task would
  // keep rendering as "archived" in every mounted store without this.
  events.emit(taskStatusUpdatedChannel, {
    taskId: updatedRow.id,
    projectId: updatedRow.projectId,
    status: 'in_progress',
  });

  // Symmetric to archiveTask, which cascade-archives every live conversation:
  // restore must un-archive them too, otherwise a restored task has no active
  // conversation and the working view shows up empty ("the session vanished").
  await restoreTaskConversations(updatedRow.projectId, updatedRow.id);
}

async function restoreTaskConversations(projectId: string, taskId: string): Promise<void> {
  const archived = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.projectId, projectId),
        eq(conversations.taskId, taskId),
        isNotNull(conversations.archivedAt)
      )
    );

  for (const { id } of archived) {
    await unarchiveConversation(projectId, taskId, id).catch((error: unknown) => {
      log.warn('restoreTask: conversation unarchive failed', {
        taskId,
        conversationId: id,
        error: String(error),
      });
    });
  }
}
