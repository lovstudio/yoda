import type { Project } from '@shared/projects';
import { DEFAULT_WORKSPACE_ID } from '@shared/workspaces';
import { getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { workspaceStore } from '@renderer/lib/stores/app-state';
import type { ProjectWorkspaceConflictChoice } from './project-workspace-conflict-modal';

/**
 * Adding a project that already exists in another workspace must not silently
 * reuse it there (the project and any new tasks would be invisible in the
 * active workspace). Asks the user to either jump to the owning workspace or
 * move the project into the active one.
 *
 * Resolves true when the project should be opened (no conflict, or conflict
 * resolved), false when the user dismissed the dialog.
 */
export async function resolveProjectWorkspaceConflict(project: Project): Promise<boolean> {
  if (workspaceStore.matchesActive(project.workspaceId)) return true;

  const choice = await new Promise<ProjectWorkspaceConflictChoice | null>((resolve) => {
    showModal('projectWorkspaceConflictModal', {
      project,
      onSuccess: resolve,
      onClose: () => resolve(null),
    });
  });
  if (choice === null) return false;

  if (choice === 'switch') {
    workspaceStore.setActiveWorkspaceId(project.workspaceId ?? DEFAULT_WORKSPACE_ID);
    return true;
  }

  const targetId =
    workspaceStore.activeWorkspaceId === DEFAULT_WORKSPACE_ID
      ? null
      : workspaceStore.activeWorkspaceId;
  getProjectStore(project.id)?.setWorkspaceId(targetId);
  await workspaceStore.assignProject(project.id, targetId);
  return true;
}
