import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { workspaceTerminalStore } from '@renderer/lib/stores/workspace-terminal-store';
import { runProjectCommand } from './run-project-command';

export type ProjectQuickActionRunResult = { kind: 'shell' } | { kind: 'agent'; taskId: string };

/**
 * The single execution boundary for a project quick action.
 *
 * Agent actions open an inspectable task that can be continued when execution
 * needs repair. Explicit shell actions create a standard project Terminal
 * owned by WorkspaceRuntimeBar and do not create or depend on a task.
 */
export async function runProjectQuickAction(args: {
  project: MountedProject;
  action: QuickAction;
  runtimeId?: RuntimeId | null;
  defaultBranch?: Branch;
}): Promise<ProjectQuickActionRunResult> {
  const { project, action, runtimeId = null, defaultBranch } = args;
  if (action.kind === 'shell') {
    await workspaceTerminalStore.runCommand(project.data, action.command, action.label);
    return { kind: 'shell' };
  }

  const taskId = await runProjectCommand({ project, action, runtimeId, defaultBranch });
  if (!taskId) {
    throw new Error('The Agent runtime or default branch is unavailable.');
  }
  return { kind: 'agent', taskId };
}
