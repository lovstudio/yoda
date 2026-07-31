import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { createQuickActionTaskName } from './quick-action-task-name';
import { runCommandInTaskTerminal } from './run-command-in-task-terminal';
import { runProjectCommand } from './run-project-command';

export type ProjectQuickActionRunResult =
  | { kind: 'shell'; taskId: string }
  | { kind: 'agent'; taskId: string };

function getActiveQuickActionTaskId(projectId: string): string | undefined {
  if (appState.navigation.currentViewId !== 'task') return undefined;
  const params = appState.navigation.viewParamsStore.task as
    | { projectId?: string; taskId?: string }
    | undefined;
  if (params?.projectId !== projectId || !params.taskId) return undefined;
  return params.taskId;
}

async function getOrCreateShellTask({
  project,
  action,
  defaultBranch,
}: {
  project: MountedProject;
  action: QuickAction;
  defaultBranch: Branch | undefined;
}) {
  const activeTaskId = getActiveQuickActionTaskId(project.data.id);
  if (activeTaskId) {
    let activeTask = asProvisioned(getTaskStore(project.data.id, activeTaskId));
    if (!activeTask) {
      await project.taskManager.provisionTask(activeTaskId);
      activeTask = asProvisioned(getTaskStore(project.data.id, activeTaskId));
    }
    if (activeTask) return activeTask;
  }

  if (!defaultBranch) {
    throw new Error('A default branch is required to open this quick action in Terminal.');
  }

  const taskId = crypto.randomUUID();
  await project.taskManager.createTask({
    id: taskId,
    projectId: project.data.id,
    name: createQuickActionTaskName(project, action.label),
    sourceBranch: defaultBranch,
    strategy: { kind: 'no-worktree' },
  });
  const task = asProvisioned(getTaskStore(project.data.id, taskId));
  if (!task) {
    throw new Error('The quick action Terminal task did not finish provisioning.');
  }
  return task;
}

/**
 * The single execution boundary for a project quick action.
 *
 * Agent actions open an inspectable task that can be continued when execution
 * needs repair. Explicit shell actions use the same persisted task Terminal
 * lifecycle as every other terminal command.
 */
export async function runProjectQuickAction(args: {
  project: MountedProject;
  action: QuickAction;
  runtimeId?: RuntimeId | null;
  defaultBranch?: Branch;
}): Promise<ProjectQuickActionRunResult> {
  const { project, action, runtimeId = null, defaultBranch } = args;
  if (action.kind === 'shell') {
    if (project.data.type !== 'local') {
      throw new Error('Programmatic quick actions currently require a local project.');
    }
    const task = await getOrCreateShellTask({ project, action, defaultBranch });
    await runCommandInTaskTerminal({
      task,
      command: action.command,
      label: action.label,
    });
    return { kind: 'shell', taskId: task.taskId };
  }

  const taskId = await runProjectCommand({ project, action, runtimeId, defaultBranch });
  if (!taskId) {
    throw new Error('The Agent runtime or default branch is unavailable.');
  }
  return { kind: 'agent', taskId };
}
