import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { MAX_WORKSPACE_NAME_LENGTH, type Workspace } from '@shared/workspaces';
import { db } from '@main/db/client';
import { projects, tasks, workspaces, type WorkspaceRow } from '@main/db/schema';

function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Workspace name cannot be empty');
  if (trimmed.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new Error(`Workspace name exceeds maximum length of ${MAX_WORKSPACE_NAME_LENGTH}`);
  }
  return trimmed;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const rows = await db
    .select()
    .from(workspaces)
    .orderBy(asc(workspaces.sortOrder), asc(workspaces.createdAt));
  return rows.map(mapWorkspaceRow);
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const normalized = normalizeName(name);
  const [{ value: maxOrder }] = await db
    .select({ value: sql<number>`coalesce(max(${workspaces.sortOrder}), -1)` })
    .from(workspaces);
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    name: normalized,
    sortOrder: (maxOrder ?? -1) + 1,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(workspaces).values(row);
  return mapWorkspaceRow(row);
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const normalized = normalizeName(name);
  const result = await db
    .update(workspaces)
    .set({ name: normalized, updatedAt: new Date().toISOString() })
    .where(eq(workspaces.id, id));
  if (result.changes === 0) throw new Error(`Workspace ${id} not found`);
}

/** Deletes a workspace; its projects fall back to the default (workspaceId = null) via the FK. */
export async function deleteWorkspace(id: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, id));
}

export async function reorderWorkspaces(orderedIds: string[]): Promise<void> {
  db.transaction((tx) => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      tx.update(workspaces)
        .set({ sortOrder: i, updatedAt: now })
        .where(eq(workspaces.id, orderedIds[i]));
    }
  });
}

export async function assignProjectToWorkspace(
  projectId: string,
  workspaceId: string | null
): Promise<void> {
  const result = await db
    .update(projects)
    .set({ workspaceId, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, projectId));
  if (result.changes === 0) throw new Error(`Project ${projectId} not found`);
}

/** Assigns a (typically projectless Drafts) task to a sidebar workspace. */
export async function assignTaskToWorkspace(
  taskId: string,
  workspaceId: string | null
): Promise<void> {
  const result = await db
    .update(tasks)
    .set({ sidebarWorkspaceId: workspaceId, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, taskId));
  if (result.changes === 0) throw new Error(`Task ${taskId} not found`);
}
