import type { ComposerDefaults } from '@shared/project-settings';
import { log } from '@main/lib/logger';
import { projectManager } from '../project-manager';

export async function getProjectComposerDefaults(
  projectId?: string | null
): Promise<ComposerDefaults | undefined> {
  if (!projectId) return undefined;
  const project = projectManager.getProject(projectId);
  if (!project) return undefined;

  try {
    return (await project.settings.get()).composerDefaults;
  } catch (error) {
    log.warn('Failed to load project composer defaults', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
