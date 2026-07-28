import type { RuntimeId } from '@shared/runtime-registry';
import type { SkillSelectionInput } from '@shared/skills/types';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { initialConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { rpc } from '@renderer/lib/ipc';

export type AiLabBuildTaskLaunch = {
  taskId: string;
  conversationId: string;
  promise: Promise<void>;
};

export async function startAiLabBuildTask(input: {
  project: MountedProject;
  appId?: string;
  prompt: string;
  taskName: string;
  runtimeId: RuntimeId;
  model?: string | null;
  systemPrompt?: string;
  imagePaths?: string[];
  skillSelection?: SkillSelectionInput;
}): Promise<AiLabBuildTaskLaunch> {
  const taskId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const plan = await rpc.aiLab.prepareBuildTask({
    appId: input.appId,
    prompt: input.prompt,
    projectId: input.project.data.id,
    taskId,
    conversationId,
    runtimeId: input.runtimeId,
    model: input.model,
    systemPrompt: input.systemPrompt,
  });
  const promise = input.project.taskManager
    .createTask({
      id: taskId,
      projectId: input.project.data.id,
      name: input.taskName,
      sourceBranch: { type: 'local', branch: input.project.data.baseRef },
      strategy: { kind: 'no-worktree' },
      initialConversation: {
        id: conversationId,
        projectId: input.project.data.id,
        taskId,
        runtime: input.runtimeId,
        title: initialConversationTitle(input.runtimeId, input.prompt, []),
        initialPrompt: plan.initialPrompt,
        imagePaths: input.imagePaths,
        model: input.model,
        skillSelection: input.skillSelection,
      },
    })
    .catch(async (error: unknown) => {
      await rpc.aiLab.cancelBuildTask(taskId).catch(() => undefined);
      throw error;
    });
  return { taskId, conversationId, promise };
}
