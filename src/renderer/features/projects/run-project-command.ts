import {
  appendDeliverySummaryContext,
  shouldAttachReleaseChangelogContext,
} from '@shared/agent-command-context';
import { applyAgentCommandPrefix } from '@shared/agent-command-prefix';
import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import type { QuickActionTaskSource } from '@shared/tasks';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { createQuickActionTaskName } from './quick-action-task-name';

/**
 * Spawn a one-shot task in the given project to run a quick-action command.
 * Uses no-worktree strategy so the task lives in the main repo. Returns the
 * new taskId, or null if prerequisites are missing.
 */
export async function runProjectCommand(args: {
  project: MountedProject;
  action: QuickAction;
  runtimeId: RuntimeId | null;
  defaultBranch: Branch | undefined;
  quickActionSource?: Omit<QuickActionTaskSource, 'conversationId'>;
  onTaskCreated?: (taskId: string) => void;
}): Promise<string | null> {
  const { project, action, runtimeId, defaultBranch, quickActionSource, onTaskCreated } = args;
  const command = runtimeId ? applyAgentCommandPrefix(runtimeId, action.command) : '';
  if (!command || !runtimeId || !defaultBranch) return null;

  let initialPrompt = command;
  if (!quickActionSource && shouldAttachReleaseChangelogContext(command)) {
    try {
      const summaries = await rpc.conversations.getProjectDeliverySummaries(project.data.id, 8);
      initialPrompt = appendDeliverySummaryContext(command, summaries, 'release');
    } catch (error) {
      log.warn('runProjectCommand: failed to attach changelog context', {
        projectId: project.data.id,
        error: String(error),
      });
    }
  }

  const taskName = createQuickActionTaskName(project, action.label);

  const taskId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const createPromise = project.taskManager.createTask({
    id: taskId,
    projectId: project.data.id,
    name: taskName,
    sourceBranch: defaultBranch,
    strategy: { kind: 'no-worktree' },
    quickActionId: action.id,
    quickActionSource: quickActionSource ? { ...quickActionSource, conversationId } : undefined,
    initialConversation: {
      id: conversationId,
      projectId: project.data.id,
      taskId,
      runtime: runtimeId,
      title: action.label || command,
      initialPrompt,
    },
  });
  onTaskCreated?.(taskId);
  await createPromise;
  return taskId;
}
