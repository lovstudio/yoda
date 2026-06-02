import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { LocalProject, SshProject } from '@shared/projects';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

type ProjectRow = typeof projects.$inferSelect;

function mapProjectRow(row: ProjectRow): LocalProject | SshProject {
  if (row.workspaceProvider === 'local') {
    return {
      type: 'local' as const,
      id: row.id,
      name: row.name,
      alias: row.alias,
      path: row.path,
      baseRef: row.baseRef ?? 'main',
      isInternal: row.isInternal === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  return {
    type: 'ssh' as const,
    id: row.id,
    name: row.name,
    alias: row.alias,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    connectionId: row.sshConnectionId!,
    isInternal: row.isInternal === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map(mapProjectRow);
}

export async function getArchivedProjects(): Promise<(LocalProject | SshProject)[]> {
  const rows = await db
    .select()
    .from(projects)
    .where(isNotNull(projects.archivedAt))
    .orderBy(desc(projects.updatedAt));
  return rows.map(mapProjectRow);
}

export async function getProjectById(
  projectId: string
): Promise<LocalProject | SshProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return undefined;
  return mapProjectRow(row);
}

export async function getLocalProjectByPath(path: string): Promise<LocalProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
  if (!row) return undefined;
  const project = mapProjectRow(row);
  return project.type === 'local' ? project : undefined;
}

export async function getSshProjectByPath(
  path: string,
  connectionId: string
): Promise<SshProject | undefined> {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.path, path), eq(projects.sshConnectionId, connectionId)))
    .limit(1);
  if (!row) return undefined;
  const project = mapProjectRow(row);
  return project.type === 'ssh' ? project : undefined;
}
