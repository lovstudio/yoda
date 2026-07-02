import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import {
  acquireProjectViewWorkspace,
  releaseProjectViewWorkspace,
} from '@main/core/workspaces/project-view-workspace';
import { archiveProject } from './operations/archiveProject';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getArchivedProjects, getProjects } from './operations/getProjects';
import { moveProjectPath } from './operations/moveProjectPath';
import { openProject } from './operations/openProject';
import { prepareQuickProject } from './operations/prepareQuickProject';
import { unarchiveProject } from './operations/unarchiveProject';
import { updateProjectAlias } from './operations/updateProjectAlias';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { projectManager } from './project-manager';
import {
  getProjectSettingsPage,
  shareProjectSettingsToConfig,
  updateProjectSettings,
} from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  prepareQuickProject,
  inspectProjectPath,
  getProjects,
  getArchivedProjects,
  deleteProject,
  archiveProject,
  unarchiveProject,
  getProjectSettingsPage,
  updateProjectSettings,
  shareProjectSettingsToConfig,
  updateProjectConnection,
  updateProjectAlias,
  moveProjectPath,
  openProject,

  // Acquires the slim project-view workspace that backs project-level file
  // tabs. Refcounted — callers must pair with releaseProjectViewWorkspace.
  acquireProjectViewWorkspace: async (projectId: string) => {
    const provider = projectManager.getProject(projectId);
    if (!provider) {
      return err({ type: 'not_found' as const, entity: 'project' as const, detail: undefined });
    }
    try {
      const workspace = await acquireProjectViewWorkspace(provider);
      return ok({ workspaceId: workspace.id });
    } catch (e) {
      return err({ type: 'workspace_error' as const, message: String(e) });
    }
  },

  releaseProjectViewWorkspace: async (projectId: string) => {
    const provider = projectManager.getProject(projectId);
    if (!provider) {
      return err({ type: 'not_found' as const, entity: 'project' as const, detail: undefined });
    }
    await releaseProjectViewWorkspace(provider);
    return ok(undefined);
  },
});
