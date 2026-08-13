import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { type ProjectTaskCounts, type Task } from '@shared/tasks';
import { db } from '@main/db/client';
import { conversations, tasks, type TaskRow } from '@main/db/schema';
import { mapTaskRowToTask } from '../utils/utils';
import { getIssuesForTasks } from './task-issues';

export async function getTasks(projectId?: string): Promise<Task[]> {
  return hydrateTaskRows(await selectTaskRows({ projectId }));
}

/** Mobile/global active snapshot: filter archived rows before task hydration. */
export async function getAllActiveTasks(): Promise<Task[]> {
  return hydrateTaskRows(await selectTaskRows({ archived: false }));
}

/**
 * Lightweight project-recency input. Archived task activity still contributes
 * to project ordering, but does not need conversation or issue hydration.
 */
export async function getAllTaskActivityTimestamps(): Promise<
  Array<{
    projectId: string;
    createdAt: string;
    updatedAt: string;
    lastInteractedAt: string | null;
  }>
> {
  return db
    .select({
      projectId: tasks.projectId,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      lastInteractedAt: tasks.lastInteractedAt,
    })
    .from(tasks);
}

/** Renderer mount snapshot: active tasks only. Internal all-task callers keep getTasks(). */
export async function getActiveTasks(projectId: string): Promise<Task[]> {
  return hydrateTaskRows(await selectTaskRows({ projectId, archived: false }));
}

/** Explicit lazy archive snapshot used only while the Archived view is open. */
export async function getArchivedTasks(projectId: string): Promise<Task[]> {
  return hydrateTaskRows(await selectTaskRows({ projectId, archived: true }));
}

/** Sidebar priority-mode archive page. Hydrates only the requested global slice. */
export async function getArchivedTasksPage(
  projectIds: string[],
  offset: number,
  limit: number
): Promise<Task[]> {
  const uniqueProjectIds = [...new Set(projectIds)];
  if (uniqueProjectIds.length === 0) return [];
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) return [];
  return hydrateTaskRows(
    await selectTaskRows({
      projectIds: uniqueProjectIds,
      archived: true,
      offset: normalizedOffset,
      limit: normalizedLimit,
    })
  );
}

/** Project-qualified point lookup for deep links and cross-renderer task events. */
export async function getTask(projectId: string, taskId: string): Promise<Task | null> {
  const hydrated = await hydrateTaskRows(await selectTaskRows({ projectId, taskId }));
  return hydrated[0] ?? null;
}

/** Affected-row batch lookup for cascaded restore events; never scans unrelated active tasks. */
export async function getTasksByIds(projectId: string, taskIds: string[]): Promise<Task[]> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return [];
  return hydrateTaskRows(await selectTaskRows({ projectId, taskIds: uniqueTaskIds }));
}

/** Project totals without materializing task rows or their observable renderer stores. */
export async function getTaskCounts(projectId?: string): Promise<ProjectTaskCounts[]> {
  const query = db
    .select({
      projectId: tasks.projectId,
      active: sql<number>`sum(case when ${tasks.archivedAt} is null then 1 else 0 end)`,
      archived: sql<number>`sum(case when ${tasks.archivedAt} is not null then 1 else 0 end)`,
    })
    .from(tasks)
    .groupBy(tasks.projectId);
  const rows = projectId ? await query.where(eq(tasks.projectId, projectId)) : await query;

  return rows.map((row) => ({
    projectId: row.projectId,
    active: Number(row.active),
    archived: Number(row.archived),
  }));
}

async function selectTaskRows(options: {
  projectId?: string;
  projectIds?: string[];
  taskId?: string;
  taskIds?: string[];
  archived?: boolean;
  offset?: number;
  limit?: number;
}): Promise<TaskRow[]> {
  const filters = [];
  if (options.projectId) filters.push(eq(tasks.projectId, options.projectId));
  if (options.projectIds) filters.push(inArray(tasks.projectId, options.projectIds));
  if (options.taskId) filters.push(eq(tasks.id, options.taskId));
  if (options.taskIds) filters.push(inArray(tasks.id, options.taskIds));
  if (options.archived === true) filters.push(isNotNull(tasks.archivedAt));
  if (options.archived === false) filters.push(isNull(tasks.archivedAt));

  let query = db
    .select()
    .from(tasks)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .$dynamic();
  if (options.limit !== undefined) query = query.limit(options.limit);
  if (options.offset !== undefined) query = query.offset(options.offset);
  return query;
}

async function hydrateTaskRows(rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];

  const taskIds = rows.map((r) => r.id);

  const convRows = await db
    .select({
      taskId: conversations.taskId,
      runtime: conversations.runtime,
      count: count(),
    })
    .from(conversations)
    .where(and(inArray(conversations.taskId, taskIds), isNull(conversations.archivedAt)))
    .groupBy(conversations.taskId, conversations.runtime);

  const convByTask = new Map<string, Record<string, number>>();
  const issuesByTask = await getIssuesForTasks(taskIds);
  for (const { taskId, runtime, count: c } of convRows) {
    const rec = convByTask.get(taskId) ?? {};
    rec[runtime ?? 'unknown'] = c;
    convByTask.set(taskId, rec);
  }

  return rows.map((row) => ({
    ...mapTaskRowToTask(row, [], convByTask.get(row.id) ?? {}, issuesByTask.get(row.id)),
    prs: [],
  }));
}
