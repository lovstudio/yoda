import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { INTERNAL_PROJECT_ID, type LocalProject } from '@shared/projects';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { projectManager } from '../project-manager';

const INTERNAL_PROJECT_NAME = 'Default';
const INTERNAL_PROJECT_DIRNAME = 'Yoda';

function internalProjectPath(): string {
  return join(homedir(), 'Documents', INTERNAL_PROJECT_DIRNAME);
}

/**
 * Lazy-creates (idempotent) the singleton internal "Drafts" project that
 * hosts standalone agent sessions (no git, no worktree). Returns the project
 * row mapped to a LocalProject. Mounts it on projectManager if not already
 * mounted.
 */
export async function ensureInternalProject(): Promise<LocalProject> {
  const path = internalProjectPath();
  await mkdir(path, { recursive: true });

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, INTERNAL_PROJECT_ID))
    .limit(1);

  let row = existing;
  if (!row) {
    [row] = await db
      .insert(projects)
      .values({
        id: INTERNAL_PROJECT_ID,
        name: INTERNAL_PROJECT_NAME,
        path,
        workspaceProvider: 'local',
        isInternal: 1,
        baseRef: 'main',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning();
  } else if (row.path !== path || row.isInternal !== 1 || row.name !== INTERNAL_PROJECT_NAME) {
    // Heal drift (moved $HOME, a pre-existing row, or the old 'Drafts' name).
    // Only `name` is reconciled — user-facing renames go through `alias`, so
    // this never clobbers a custom project name.
    [row] = await db
      .update(projects)
      .set({ path, name: INTERNAL_PROJECT_NAME, isInternal: 1, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projects.id, INTERNAL_PROJECT_ID))
      .returning();
  }

  const project: LocalProject = {
    type: 'local',
    id: row.id,
    name: row.name,
    alias: row.alias,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    workspaceId: row.workspaceId ?? null,
    isInternal: row.isInternal === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (!projectManager.getProject(project.id)) {
    const result = await projectManager.openProject(project);
    if (!result.success) {
      log.warn('ensureInternalProject: failed to mount internal project', {
        projectId: project.id,
        error: result.error,
      });
    }
  }

  return project;
}
