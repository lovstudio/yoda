import { eq } from 'drizzle-orm';
import { findProjectFacet, formatFacetInstructions } from '@shared/project-facets';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { projectManager } from './project-manager';

/**
 * Builds the facet system-prompt block for a task, or undefined when the task
 * belongs to no facet (or its facet definition has since been removed). Lives in
 * the projects module for the same reason as `getProjectPromptPrinciples`: the
 * conversation spawn path must not pull the project/db import chain.
 */
export async function getTaskFacetInstructions(
  projectId: string,
  taskId: string
): Promise<string | undefined> {
  const [row] = await db
    .select({ facetId: tasks.facetId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row?.facetId) return undefined;

  const project = projectManager.getProject(projectId);
  if (!project) return undefined;

  const facet = findProjectFacet((await project.settings.get()).facets, row.facetId);
  if (!facet) return undefined;
  return formatFacetInstructions(facet);
}
