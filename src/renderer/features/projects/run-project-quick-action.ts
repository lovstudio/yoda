import type { Branch } from '@shared/git';
import type { QuickAction } from '@shared/project-settings';
import type { RuntimeId } from '@shared/runtime-registry';
import type { MountedProject } from '@renderer/features/projects/stores/project';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { workspaceShellStore } from '@renderer/lib/stores/workspace-shell-store';
import { runProjectCommand } from './run-project-command';

export type ProjectQuickActionRunResult = { kind: 'shell' } | { kind: 'agent'; taskId: string };

function getActiveQuickActionHost(projectId: string) {
  if (appState.navigation.currentViewId !== 'task') return undefined;
  const params = appState.navigation.viewParamsStore.task as
    | { projectId?: string; taskId?: string }
    | undefined;
  if (params?.projectId !== projectId || !params.taskId) return undefined;
  return asProvisioned(getTaskStore(projectId, params.taskId));
}

/**
 * The single execution boundary for a project quick action.
 *
 * Compiled actions execute their reviewed shell command directly. Legacy Agent
 * actions keep the original task/prompt behavior for backward compatibility.
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
    const host = getActiveQuickActionHost(project.data.id);
    if (host) {
      host.taskView.setBottomPanelTab('terminals', { ensureTerminal: false });
      host.taskView.setBottomPanelOpen(true);
      host.taskView.setFocusedRegion('bottom');
    }
    await workspaceShellStore.runCommand(
      action.command,
      project.data.path,
      action.label,
      host?.taskId ?? null
    );
    return { kind: 'shell' };
  }

  const taskId = await runProjectCommand({ project, action, runtimeId, defaultBranch });
  if (!taskId) {
    throw new Error('The Agent runtime or default branch is unavailable.');
  }
  return { kind: 'agent', taskId };
}
