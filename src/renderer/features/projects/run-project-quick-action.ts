import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import type { QuickActionTaskSource } from '@shared/tasks';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { runProjectCommand } from './run-project-command';

export type ProjectQuickActionRunResult =
  | { kind: 'command'; terminalId: string }
  | { kind: 'skill'; taskId: string };

/**
 * The single execution boundary for a project quick action.
 *
 * Skill actions open an inspectable task that can be continued when execution
 * needs judgment. Commands create a standard project Terminal
 * owned by WorkspaceRuntimeBar and do not create or depend on a task.
 */
export async function runProjectQuickAction(args: {
  project: MountedProject;
  action: QuickAction;
  runtimeId?: RuntimeId | null;
  defaultBranch?: Branch;
  quickActionSource?: Omit<QuickActionTaskSource, 'conversationId'>;
  onTaskCreated?: (taskId: string) => void;
}): Promise<ProjectQuickActionRunResult> {
  const {
    project,
    action,
    runtimeId = null,
    defaultBranch,
    quickActionSource,
    onTaskCreated,
  } = args;
  if (action.kind === 'command') {
    const terminalId = await workspaceTerminalStore.runCommand(
      project.data,
      action.command,
      action.label,
      action.id
    );
    return { kind: 'command', terminalId };
  }

  const taskId = await runProjectCommand({
    project,
    action,
    runtimeId,
    defaultBranch,
    quickActionSource,
    onTaskCreated,
  });
  if (!taskId) {
    throw new Error('The Agent runtime or default branch is unavailable.');
  }
  return { kind: 'skill', taskId };
}
