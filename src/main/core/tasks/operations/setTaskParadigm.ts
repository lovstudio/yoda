import { eq, sql } from 'drizzle-orm';
import { taskParadigmUpdatedChannel } from '@shared/events/taskEvents';
import type { ParadigmStamp } from '@shared/paradigms/stamp';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { events } from '@main/lib/events';

/**
 * Records the paradigm driving an existing task.
 *
 * `createTask` stamps the tasks a paradigm creates, but team and review can also
 * be injected into a task that already exists — and that task was stamped by
 * whatever launched it first. Without this the canvas would keep reading the
 * original stamp and render, say, an injected team as a single-Agent task.
 *
 * The stamp is overwritten rather than merged: the newest paradigm is the one
 * driving the task from here on.
 */
export async function setTaskParadigm(taskId: string, paradigm: ParadigmStamp): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) throw new Error(`Task not found: ${taskId}`);

  await db
    .update(tasks)
    .set({
      paradigmId: paradigm.paradigmId,
      paradigmKind: paradigm.paradigmKind,
      paradigmParams: paradigm.paradigmParams,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));

  // Task lists render the marker from the stamp, so a re-stamp has to reach every
  // renderer — including the windows that did not ask for it.
  events.emit(taskParadigmUpdatedChannel, { taskId, projectId: row.projectId, paradigm });
}

/**
 * Stamp a task with `paradigm` unless it is already driven by that kind.
 *
 * For orchestrations that can be started without going through a paradigm launcher
 * — a Room created straight from the rooms panel, the Feature workflow started by
 * the create-task modal. Those tasks would otherwise carry whatever stamp their
 * creation left, and read as single-Agent in every task list.
 *
 * Kind-level, not instance-level: a launcher that already recorded *which* team
 * runs the task knows more than this does, so its stamp is left alone.
 */
export async function claimTaskParadigm(taskId: string, paradigm: ParadigmStamp): Promise<void> {
  const [row] = await db
    .select({ paradigmKind: tasks.paradigmKind })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row || row.paradigmKind === paradigm.paradigmKind) return;
  await setTaskParadigm(taskId, paradigm);
}
