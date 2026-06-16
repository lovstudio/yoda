import type { ProjectPromptPrinciples } from '@shared/project-settings';
import { projectManager } from './project-manager';

/**
 * Reads a project's prompt-principle layer (global overrides + project-local
 * items) from its effective settings. Lives in the projects module — not in
 * the conversation spawn path — so the conversation unit tests don't pull the
 * project/db import chain. Returns undefined when the project is unknown.
 */
export async function getProjectPromptPrinciples(
  projectId: string
): Promise<ProjectPromptPrinciples | undefined> {
  const project = projectManager.getProject(projectId);
  if (!project) return undefined;
  return (await project.settings.get()).promptPrinciples;
}
