import { createRPCController } from '@shared/ipc/rpc';
import type { CompileQuickActionInput } from '@shared/quick-actions';
import { projectManager } from '@main/core/projects/project-manager';
import { compileQuickAction } from './quick-action-compiler';

async function compile(input: CompileQuickActionInput) {
  const project = projectManager.getProject(input.projectId);
  if (!project) throw new Error('The project is not mounted.');
  if (!project.ctx.supportsLocalSpawn) {
    throw new Error('Programmatic quick actions currently require a local project.');
  }
  return compileQuickAction({
    intent: input.intent,
    projectPath: project.repoPath,
    runtimeId: input.runtimeId,
  });
}

export const quickActionsController = createRPCController({ compile });
