import { createRPCController } from '@shared/ipc/rpc';
import type { CompileQuickActionInput } from '@shared/quick-actions';
import { getConversationDeliverySummary } from '@main/core/conversations/session-summary-context';
import { projectManager } from '@main/core/projects/project-manager';
import { discoverProjectPackageScripts } from './discover-project-package-scripts';
import { compileQuickAction } from './quick-action-compiler';

async function compile(input: CompileQuickActionInput) {
  const project = projectManager.getProject(input.projectId);
  if (!project) throw new Error('The project is not mounted.');
  if (!project.ctx.supportsLocalSpawn) {
    throw new Error('Programmatic quick actions currently require a local project.');
  }
  const executionSummary = input.taskContext
    ? await getConversationDeliverySummary(
        {
          projectId: input.projectId,
          taskId: input.taskContext.taskId,
          conversationId: input.taskContext.conversationId,
        },
        { refresh: true }
      )
        .then((summary) => summary?.text)
        .catch(() => undefined)
    : undefined;
  return compileQuickAction({
    intent: input.intent,
    projectPath: project.repoPath,
    runtimeId: input.runtimeId,
    executionSummary,
  });
}

async function discover(projectId: string) {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error('The project is not mounted.');
  return discoverProjectPackageScripts(project.fs);
}

export const quickActionsController = createRPCController({ compile, discover });
