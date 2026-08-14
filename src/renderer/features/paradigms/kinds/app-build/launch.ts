import { appBuildParadigmKind, paradigmSlot } from '@shared/paradigms/kinds';
import { ensureUniqueTaskDisplayName, taskNameFromPrompt } from '@shared/task-name';
import { createAiLabProject } from '@renderer/features/ai-lab/create-ai-lab-project';
import { startAiLabBuildTask } from '@renderer/features/ai-lab/start-ai-lab-build-task';
import { toast } from '@renderer/lib/hooks/use-toast';
import { agentRuntimeSettings, agentSkillSelection } from '../../agent-launch-settings';
import { launchableSlot, type ParadigmLauncher } from '../../launch-context';

const AGENT_SLOT = paradigmSlot('app-build', 'agent');

/**
 * Scaffolds its own project and builds an app in it, so it never joins a task
 * and never cuts a branch. The requirement doubles as the project name, which is
 * why the rewrite has to resolve before anything is created.
 */
export const appBuildLauncher: ParadigmLauncher = {
  descriptor: appBuildParadigmKind,
  async launch(ctx) {
    const slot = launchableSlot(ctx.resolveSlot(AGENT_SLOT.storageKey));
    if (!slot) return;
    const requirement = await ctx.resolveRequirement();
    if (!requirement) return;
    const projectName = taskNameFromPrompt(requirement) || ctx.t('home.defaultAppProjectName');
    try {
      const project = await createAiLabProject(projectName);
      const launch = await startAiLabBuildTask({
        prompt: requirement,
        project,
        taskName: ensureUniqueTaskDisplayName(
          ctx.t('home.buildTaskName'),
          Array.from(project.taskManager.tasks.values(), (task) => task.data.name)
        ),
        runtimeId: slot.provider,
        ...agentRuntimeSettings(slot.agent, slot.provider),
        systemPrompt: slot.systemPrompt,
        imagePaths: ctx.imagePaths,
        skillSelection: agentSkillSelection(slot.agent),
      });
      void launch.promise.catch((error: unknown) => {
        toast.error(ctx.t('home.buildFailed'), {
          description: error instanceof Error ? error.message : ctx.t('common.unknownError'),
        });
      });
      ctx.focusTask(project.data.id, launch.taskId);
      toast.success(ctx.t('home.buildStarted'), {
        description: ctx.t('home.buildStartedDescription'),
      });
      ctx.finish();
    } catch (error) {
      toast.error(ctx.t('home.buildFailed'), {
        description: error instanceof Error ? error.message : ctx.t('common.unknownError'),
      });
    }
  },
};
