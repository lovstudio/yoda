import { createRPCController } from '@shared/ipc/rpc';
import { projectManager } from '@main/core/projects/project-manager';
import { discoverProjectLaunchCommands } from './discover-project-launch-commands';

async function discover(projectId: string) {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error('The project is not mounted.');
  return discoverProjectLaunchCommands(project.fs);
}

export const quickActionsController = createRPCController({ discover });
