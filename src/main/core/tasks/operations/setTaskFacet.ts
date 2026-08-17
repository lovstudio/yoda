import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

/**
 * Assigns a task to a project facet, or clears the assignment with null. No
 * event is emitted — the renderer applies an optimistic update and rolls back on
 * failure, the same contract as `setTaskLongTerm`.
 */
export async function setTaskFacet(taskId: string, facetId: string | null): Promise<void> {
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  await db
    .update(tasks)
    .set({
      facetId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
}
